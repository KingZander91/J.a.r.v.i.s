import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentProfile,
  AppSettings,
  Artifact,
  ArtifactMeta,
  ChatMessage,
  Memory,
  PlanTask,
  ProviderStatus,
  PublicSettings,
  Session,
  SessionSummary,
  Usage,
} from '../shared/types';
import {
  DATA_DIR,
  ENV_KEYS,
  PROVIDERS,
  VERSION,
  type ProviderPreset,
} from './config';
import { defaultAgents } from './seed';
import {
  atomicWrite,
  clamp,
  now,
  stripMarkdown,
  titleFromInput,
  truncate,
  uid,
} from './util';

interface Database {
  version: number;
  settings: AppSettings;
  agents: AgentProfile[];
  sessions: Session[];
  memories: Memory[];
  artifacts: Artifact[];
}

interface Secrets {
  providerKeys: Record<string, string>;
  tavilyKey?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  model: {
    provider: 'demo',
    model: PROVIDERS.demo.model,
    baseUrl: '',
    temperature: 0.7,
    maxTokens: 4096,
  },
  maxSteps: 12,
  autoMemory: true,
  yoloMode: false,
  approvalTimeoutMs: 300_000,
  systemPromptExtra: '',
  tools: {},
};

function emptyDb(): Database {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    agents: defaultAgents(now()),
    sessions: [],
    memories: [],
    artifacts: [],
  };
}

function normalizeSession(session: Session): Session {
  return {
    ...session,
    messages: session.messages ?? [],
    plan: session.plan ?? [],
    artifacts: session.artifacts ?? [],
    usage: session.usage ?? { inputTokens: 0, outputTokens: 0 },
    runCount: session.runCount ?? 0,
  };
}

export class Store {
  private db: Database;
  private secrets: Secrets;
  private readonly dbFile: string;
  private readonly secretsFile: string;

  constructor(private readonly dataDir: string = DATA_DIR) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbFile = path.join(dataDir, 'jarvis.json');
    this.secretsFile = path.join(dataDir, 'secrets.json');
    this.db = this.loadDb();
    this.secrets = this.loadSecrets();
    this.persist();
  }

  private loadDb(): Database {
    try {
      if (!fs.existsSync(this.dbFile)) return emptyDb();
      const raw = JSON.parse(fs.readFileSync(this.dbFile, 'utf8')) as Partial<Database>;
      const db: Database = {
        version: raw.version ?? 1,
        settings: {
          ...structuredClone(DEFAULT_SETTINGS),
          ...(raw.settings ?? {}),
          model: {
            ...DEFAULT_SETTINGS.model,
            ...(raw.settings?.model ?? {}),
          },
          tools: {
            ...DEFAULT_SETTINGS.tools,
            ...(raw.settings?.tools ?? {}),
          },
        },
        agents: (raw.agents?.length ? raw.agents : defaultAgents(now())) as AgentProfile[],
        sessions: (raw.sessions ?? []).map(normalizeSession),
        memories: raw.memories ?? [],
        artifacts: raw.artifacts ?? [],
      };
      // Restore any missing built-in agents without overwriting operator edits.
      for (const agent of defaultAgents(now())) {
        if (!db.agents.some((existing) => existing.id === agent.id)) {
          db.agents.push(agent);
        }
      }
      return db;
    } catch (error) {
      console.error('[store] Failed to read database, starting fresh:', error);
      return emptyDb();
    }
  }

  private loadSecrets(): Secrets {
    try {
      if (!fs.existsSync(this.secretsFile)) {
        return { providerKeys: {} };
      }
      const raw = JSON.parse(fs.readFileSync(this.secretsFile, 'utf8')) as Partial<Secrets>;
      return { providerKeys: raw.providerKeys ?? {}, tavilyKey: raw.tavilyKey };
    } catch {
      return { providerKeys: {} };
    }
  }

  private persist(): void {
    atomicWrite(this.dbFile, JSON.stringify(this.db, null, 2), 0o600);
  }

  private persistSecrets(): void {
    atomicWrite(this.secretsFile, JSON.stringify(this.secrets, null, 2), 0o600);
  }

  /* ── Settings & providers ─────────────────────────────────────── */

  getSettings(): AppSettings {
    return this.db.settings;
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const merged = {
      ...this.db.settings,
      ...patch,
      model: {
        ...this.db.settings.model,
        ...(patch.model ?? {}),
      },
      tools: {
        ...this.db.settings.tools,
        ...(patch.tools ?? {}),
      },
    } satisfies AppSettings;

    merged.model.temperature = clamp(Number(merged.model.temperature) || 0.7, 0, 2);
    merged.model.maxTokens = Math.round(clamp(Number(merged.model.maxTokens) || 4096, 256, 32768));
    merged.maxSteps = Math.round(clamp(Number(merged.maxSteps) || 12, 1, 24));
    merged.approvalTimeoutMs = Math.round(
      clamp(Number(merged.approvalTimeoutMs) || 300_000, 10_000, 1_800_000),
    );
    if (!PROVIDERS[merged.model.provider]) {
      merged.model.provider = 'demo';
    }
    this.db.settings = merged;
    this.persist();
    return merged;
  }

  resolveKey(provider: string): string | undefined {
    const env = ENV_KEYS[provider];
    if (env && env.trim()) return env.trim();
    const saved = this.secrets.providerKeys[provider];
    return saved && saved.trim() ? saved.trim() : undefined;
  }

  keyState(provider: string): PublicSettings['keyStates'][string] {
    const preset = PROVIDERS[provider];
    if (!preset) return 'missing';
    if (ENV_KEYS[provider]?.trim()) return 'env';
    if (this.secrets.providerKeys[provider]?.trim()) return 'saved';
    if (!preset.keyRequired) return 'not_required';
    return 'missing';
  }

  setProviderKey(provider: string, key: string | null): void {
    if (!PROVIDERS[provider] || provider === 'demo') return;
    if (!key) {
      delete this.secrets.providerKeys[provider];
    } else {
      this.secrets.providerKeys[provider] = key.trim();
    }
    this.persistSecrets();
  }

  getTavilyKey(): string | undefined {
    return (
      process.env.TAVILY_API_KEY?.trim() ||
      this.secrets.tavilyKey?.trim() ||
      undefined
    );
  }

  setTavilyKey(key: string | null): void {
    if (!key) {
      delete this.secrets.tavilyKey;
    } else {
      this.secrets.tavilyKey = key.trim();
    }
    this.persistSecrets();
  }

  providerStatus(): ProviderStatus {
    const provider = this.db.settings.model.provider;
    const preset: ProviderPreset = PROVIDERS[provider] ?? PROVIDERS.demo;
    const keyState = this.keyState(provider);
    const configured =
      provider === 'demo' ||
      !preset.keyRequired ||
      keyState === 'env' ||
      keyState === 'saved';
    return {
      configured,
      demo: provider === 'demo',
      keyState,
      label: preset.label,
      hint:
        keyState === 'missing'
          ? `Add a ${preset.label} API key in Settings → Model, or switch to the simulation core.`
          : preset.hint,
    };
  }

  getPublicSettings(): PublicSettings {
    const keyStates: Record<string, PublicSettings['keyStates'][string]> = {};
    for (const id of Object.keys(PROVIDERS)) {
      keyStates[id] = this.keyState(id);
    }
    return {
      ...this.db.settings,
      model: { ...this.db.settings.model },
      providerStatus: this.providerStatus(),
      keyStates,
      tavilyConfigured: Boolean(this.getTavilyKey()),
      dataDir: this.dataDir,
      version: VERSION,
    };
  }

  /* ── Agents ───────────────────────────────────────────────────── */

  listAgents(): AgentProfile[] {
    return this.db.agents;
  }

  getAgent(id?: string): AgentProfile | undefined {
    if (!id) return this.db.agents.find((a) => a.id === 'core');
    return this.db.agents.find((a) => a.id === id);
  }

  createAgent(input: Partial<AgentProfile>): AgentProfile {
    const agent: AgentProfile = {
      id: uid('agt_'),
      name: (input.name || 'Unnamed Agent').trim().slice(0, 60),
      callsign: (input.callsign || input.name || 'AGENT').trim().toUpperCase().slice(0, 18),
      description: (input.description || 'Custom intelligence.').slice(0, 240),
      systemPrompt: input.systemPrompt || '',
      accent: input.accent || 'teal',
      icon: input.icon || 'custom',
      tools: Array.isArray(input.tools) && input.tools.length ? input.tools : ['*'],
      builtin: false,
      createdAt: now(),
    };
    this.db.agents.push(agent);
    this.persist();
    return agent;
  }

  updateAgent(id: string, patch: Partial<AgentProfile>): AgentProfile | undefined {
    const agent = this.db.agents.find((a) => a.id === id);
    if (!agent) return undefined;
    if (patch.name !== undefined) agent.name = patch.name.trim().slice(0, 60) || agent.name;
    if (patch.callsign !== undefined)
      agent.callsign = patch.callsign.trim().toUpperCase().slice(0, 18) || agent.callsign;
    if (patch.description !== undefined)
      agent.description = patch.description.slice(0, 240);
    if (patch.systemPrompt !== undefined) agent.systemPrompt = patch.systemPrompt;
    if (patch.accent !== undefined) agent.accent = patch.accent;
    if (patch.icon !== undefined) agent.icon = patch.icon;
    if (patch.tools !== undefined)
      agent.tools = patch.tools.length ? patch.tools : ['*'];
    this.persist();
    return agent;
  }

  deleteAgent(id: string): boolean {
    const agent = this.db.agents.find((a) => a.id === id);
    if (!agent || agent.builtin || id === 'core') return false;
    this.db.agents = this.db.agents.filter((a) => a.id !== id);
    for (const session of this.db.sessions) {
      if (session.agentId === id) session.agentId = 'core';
    }
    this.persist();
    return true;
  }

  /* ── Sessions ─────────────────────────────────────────────────── */

  private toSummary(session: Session): SessionSummary {
    const lastMessage = session.messages[session.messages.length - 1];
    return {
      id: session.id,
      title: session.title,
      agentId: session.agentId,
      messageCount: session.messages.length,
      pinned: session.pinned,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      preview: lastMessage
        ? truncate(stripMarkdown(lastMessage.content), 110)
        : 'No transmissions yet',
    };
  }

  listSessions(): SessionSummary[] {
    return [...this.db.sessions]
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      })
      .map((s) => this.toSummary(s));
  }

  getSession(id: string): Session | undefined {
    return this.db.sessions.find((s) => s.id === id);
  }

  createSession(agentId = 'core', title?: string): Session {
    const agent = this.getAgent(agentId) ?? this.getAgent('core')!;
    const session: Session = {
      id: uid('ses_'),
      title: title?.trim().slice(0, 80) || 'New session',
      agentId: agent.id,
      messages: [],
      plan: [],
      artifacts: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      runCount: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.sessions.push(session);
    this.persist();
    return session;
  }

  updateSession(
    id: string,
    patch: Partial<Pick<Session, 'title' | 'agentId' | 'plan' | 'pinned' | 'usage'>> & {
      bump?: boolean;
    },
  ): Session | undefined {
    const session = this.getSession(id);
    if (!session) return undefined;
    if (patch.title !== undefined) session.title = patch.title.trim().slice(0, 100) || session.title;
    if (patch.agentId !== undefined) {
      const agent = this.getAgent(patch.agentId);
      if (agent) session.agentId = agent.id;
    }
    if (patch.plan !== undefined) session.plan = patch.plan;
    if (patch.pinned !== undefined) session.pinned = patch.pinned;
    if (patch.usage !== undefined) session.usage = patch.usage;
    if (patch.bump !== false) session.updatedAt = now();
    this.persist();
    return session;
  }

  appendMessage(sessionId: string, message: ChatMessage): Session | undefined {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    session.messages.push(message);
    session.updatedAt = now();
    if (session.title === 'New session' && message.role === 'user') {
      session.title = titleFromInput(message.content);
    }
    if (message.artifacts?.length) {
      for (const artifactId of message.artifacts) {
        if (!session.artifacts.includes(artifactId)) session.artifacts.push(artifactId);
      }
    }
    if (message.usage) {
      session.usage.inputTokens += message.usage.inputTokens;
      session.usage.outputTokens += message.usage.outputTokens;
    }
    this.persist();
    return session;
  }

  incrementRun(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    session.runCount += 1;
    session.updatedAt = now();
    this.persist();
  }

  deleteSession(id: string): boolean {
    const before = this.db.sessions.length;
    this.db.sessions = this.db.sessions.filter((s) => s.id !== id);
    this.db.artifacts = this.db.artifacts.filter((a) => a.sessionId !== id);
    const changed = this.db.sessions.length !== before;
    if (changed) this.persist();
    return changed;
  }

  setSessionPlan(id: string, plan: PlanTask[]): void {
    const session = this.getSession(id);
    if (!session) return;
    session.plan = plan;
    this.persist();
  }

  exportSessionMarkdown(id: string): string | null {
    const session = this.getSession(id);
    if (!session) return null;
    const agent = this.getAgent(session.agentId);
    const lines: string[] = [
      `# ${session.title}`,
      '',
      `**Agent:** ${agent?.name ?? 'JARVIS'} (${agent?.callsign ?? 'CORE'})  `,
      `**Created:** ${new Date(session.createdAt).toISOString()}  `,
      `**Runs:** ${session.runCount}  `,
      `**Tokens:** ${session.usage.inputTokens} in / ${session.usage.outputTokens} out`,
      '',
      '---',
      '',
    ];
    for (const message of session.messages) {
      const stamp = new Date(message.createdAt).toLocaleString();
      if (message.role === 'user') {
        lines.push(`## Operator · ${stamp}`, '', message.content, '');
      } else {
        lines.push(
          `## ${message.agentCallsign ?? 'JARVIS'} · ${stamp}`,
          '',
          message.content,
          '',
        );
      }
      if (message.toolCalls?.length) {
        lines.push(
          `> Actions: ${message.toolCalls
            .map((t) => `${t.name} (${t.status})`)
            .join(' · ')}`,
          '',
        );
      }
    }
    if (session.artifacts.length) {
      lines.push('---', '', '## Artifacts', '');
      for (const artifactId of session.artifacts) {
        const artifact = this.getArtifact(artifactId);
        if (artifact) lines.push(`- ${artifact.title} (${artifact.type})`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /* ── Memories ─────────────────────────────────────────────────── */

  listMemories(): Memory[] {
    return [...this.db.memories].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  addMemory(input: {
    content: string;
    tags?: string[];
    importance?: number;
    sourceSessionId?: string;
    sourceAgentId?: string;
  }): Memory {
    const content = input.content.trim().slice(0, 1600);
    const existing = this.db.memories.find(
      (m) => m.content.toLowerCase() === content.toLowerCase(),
    );
    if (existing) {
      existing.updatedAt = now();
      existing.importance = Math.max(
        existing.importance,
        Math.round(clamp(input.importance ?? 3, 1, 5)),
      );
      if (input.tags?.length) {
        existing.tags = Array.from(new Set([...existing.tags, ...input.tags])).slice(0, 12);
      }
      this.persist();
      return existing;
    }
    const memory: Memory = {
      id: uid('mem_'),
      content,
      tags: (input.tags ?? []).map((t) => t.trim().slice(0, 24)).filter(Boolean).slice(0, 12),
      importance: Math.round(clamp(input.importance ?? 3, 1, 5)),
      sourceSessionId: input.sourceSessionId,
      sourceAgentId: input.sourceAgentId,
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.memories.push(memory);
    this.persist();
    return memory;
  }

  updateMemory(id: string, patch: Partial<Pick<Memory, 'content' | 'tags' | 'importance'>>): Memory | undefined {
    const memory = this.db.memories.find((m) => m.id === id);
    if (!memory) return undefined;
    if (patch.content !== undefined) memory.content = patch.content.trim().slice(0, 1600);
    if (patch.tags !== undefined) memory.tags = patch.tags.slice(0, 12);
    if (patch.importance !== undefined) memory.importance = Math.round(clamp(patch.importance, 1, 5));
    memory.updatedAt = now();
    this.persist();
    return memory;
  }

  deleteMemory(id: string): boolean {
    const before = this.db.memories.length;
    this.db.memories = this.db.memories.filter((m) => m.id !== id);
    const changed = before !== this.db.memories.length;
    if (changed) this.persist();
    return changed;
  }

  searchMemories(query: string, limit = 6): Memory[] {
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2);
    if (!tokens.length) {
      return this.listMemories().slice(0, limit);
    }
    const scored = this.db.memories.map((memory) => {
      const haystack = `${memory.content} ${memory.tags.join(' ')}`.toLowerCase();
      let score = 0;
      for (const token of new Set(tokens)) {
        if (haystack.includes(token)) score += 2;
      }
      score += memory.importance * 0.5;
      const ageDays = (now() - memory.updatedAt) / 86_400_000;
      score += Math.max(0, 1.5 - ageDays * 0.05);
      return { memory, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.memory);
  }

  /* ── Artifacts ────────────────────────────────────────────────── */

  createArtifact(input: {
    sessionId: string;
    runId?: string;
    title: string;
    type: Artifact['type'];
    language?: string;
    content: string;
  }): Artifact {
    const artifact: Artifact = {
      id: uid('art_'),
      sessionId: input.sessionId,
      runId: input.runId,
      title: input.title.trim().slice(0, 120) || 'Untitled artifact',
      type: input.type,
      language: input.language?.slice(0, 24),
      content: input.content.slice(0, 400_000),
      createdAt: now(),
      size: Buffer.byteLength(input.content, 'utf8'),
    };
    this.db.artifacts.push(artifact);
    const session = this.getSession(input.sessionId);
    if (session && !session.artifacts.includes(artifact.id)) {
      session.artifacts.push(artifact.id);
      session.updatedAt = now();
    }
    this.persist();
    return artifact;
  }

  listArtifacts(sessionId?: string): ArtifactMeta[] {
    return [...this.db.artifacts]
      .filter((a) => !sessionId || a.sessionId === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ content: _content, ...meta }) => meta);
  }

  getArtifact(id: string): Artifact | undefined {
    return this.db.artifacts.find((a) => a.id === id);
  }

  deleteArtifact(id: string): boolean {
    const before = this.db.artifacts.length;
    const artifact = this.db.artifacts.find((a) => a.id === id);
    this.db.artifacts = this.db.artifacts.filter((a) => a.id !== id);
    if (artifact) {
      const session = this.getSession(artifact.sessionId);
      if (session) session.artifacts = session.artifacts.filter((a) => a !== id);
    }
    const changed = before !== this.db.artifacts.length;
    if (changed) this.persist();
    return changed;
  }

  /* ── Destructive maintenance ──────────────────────────────────── */

  resetUserData(): {
    sessions: number;
    memories: number;
    artifacts: number;
    agents: number;
  } {
    const removed = {
      sessions: this.db.sessions.length,
      memories: this.db.memories.length,
      artifacts: this.db.artifacts.length,
      agents: this.db.agents.filter((agent) => !agent.builtin && agent.id !== 'core').length,
    };
    this.db.sessions = [];
    this.db.memories = [];
    this.db.artifacts = [];
    this.db.agents = this.db.agents.filter((agent) => agent.builtin || agent.id === 'core');
    this.persist();
    return removed;
  }

  /* ── Stats ────────────────────────────────────────────────────── */

  stats(): {
    sessions: number;
    runs: number;
    memories: number;
    artifacts: number;
    inputTokens: number;
    outputTokens: number;
    tools: number;
  } {
    return {
      sessions: this.db.sessions.length,
      runs: this.db.sessions.reduce((sum, s) => sum + s.runCount, 0),
      memories: this.db.memories.length,
      artifacts: this.db.artifacts.length,
      inputTokens: this.db.sessions.reduce((sum, s) => sum + s.usage.inputTokens, 0),
      outputTokens: this.db.sessions.reduce((sum, s) => sum + s.usage.outputTokens, 0),
      tools: 0,
    };
  }

  totalUsage(): Usage {
    return this.db.sessions.reduce(
      (acc, session) => ({
        inputTokens: acc.inputTokens + session.usage.inputTokens,
        outputTokens: acc.outputTokens + session.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
  }
}
