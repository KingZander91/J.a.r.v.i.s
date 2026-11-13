import type { ArtifactMeta, Memory, PlanTask } from '../../shared/types';
import { now, truncate } from '../util';
import type { ToolContext, ToolResult } from './registry';

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{24,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/* ── Plan ───────────────────────────────────────────────────────── */

export async function updatePlanTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
  if (!rawTasks.length) throw new Error('Provide at least one task.');
  if (rawTasks.length > 12) throw new Error('A plan can hold at most 12 tasks.');

  const allowed = new Set(['pending', 'in_progress', 'done', 'failed', 'skipped']);
  const tasks: PlanTask[] = rawTasks.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const title = String(item.title ?? '').trim();
    if (!title) throw new Error(`Task ${index + 1} is missing a title.`);
    const statusRaw = String(item.status ?? 'pending');
    const status = (allowed.has(statusRaw) ? statusRaw : 'pending') as PlanTask['status'];
    return {
      id: `task-${index + 1}`,
      title: truncate(title, 180),
      status,
      ...(item.note ? { note: truncate(String(item.note), 240) } : {}),
    };
  });

  ctx.setPlan(tasks);
  const completed = tasks.filter((t) => t.status === 'done').length;
  return {
    content: JSON.stringify(
      {
        ok: true,
        tasks,
        progress: `${completed}/${tasks.length} complete`,
        note: 'Plan updated and displayed to the operator. Keep it current as you work.',
      },
      null,
      2,
    ),
    summary: `Plan updated · ${tasks.length} tasks`,
  };
}

/* ── Memory ─────────────────────────────────────────────────────── */

export async function saveMemoryTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const content = String(args.content ?? '').trim();
  if (content.length < 3) throw new Error('Memory content is too short.');
  if (content.length > 1500) throw new Error('Memory content exceeds 1,500 characters.');
  if (looksLikeSecret(content)) {
    throw new Error('Refused: the content looks like a credential or secret. Never store secrets in memory.');
  }
  const tags = Array.isArray(args.tags)
    ? args.tags.map((tag) => String(tag)).filter(Boolean)
    : [];
  const importance = Math.min(5, Math.max(1, Number(args.importance ?? 3)));
  const memory = ctx.store.addMemory({
    content,
    tags,
    importance,
    sourceSessionId: ctx.sessionId,
    sourceAgentId: ctx.agent.id,
  });
  ctx.emit({ type: 'memory', memory });
  return {
    content: JSON.stringify(
      {
        ok: true,
        memory: { id: memory.id, content: memory.content, tags: memory.tags, importance: memory.importance },
        note: 'Durable memory saved. It will be retrieved automatically when relevant.',
      },
      null,
      2,
    ),
    summary: `Memory saved · importance ${memory.importance}/5`,
    memory,
  };
}

export async function searchMemoryTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const query = String(args.query ?? '').trim();
  const memories = ctx.store.searchMemories(query, 6);
  return {
    content: JSON.stringify(
      {
        query,
        count: memories.length,
        memories: memories.map((memory) => ({
          id: memory.id,
          content: memory.content,
          tags: memory.tags,
          importance: memory.importance,
          updatedAt: new Date(memory.updatedAt).toISOString(),
        })),
        note:
          memories.length === 0
            ? 'No stored memory matched. Do not invent memories.'
            : 'Operator-approved durable memory.',
      },
      null,
      2,
    ),
    summary: `${memories.length} memory matches`,
  };
}

/* ── Artifacts ──────────────────────────────────────────────────── */

export async function createArtifactTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const title = String(args.title ?? '').trim();
  if (!title) throw new Error('Artifact title is required.');
  const content = String(args.content ?? '');
  if (!content.trim()) throw new Error('Artifact content is required.');
  if (content.length > 380_000) throw new Error('Artifact exceeds the 380,000 character limit.');
  const allowed = new Set(['markdown', 'html', 'code', 'json', 'text']);
  const typeRaw = String(args.type ?? 'markdown');
  const type = (allowed.has(typeRaw) ? typeRaw : 'markdown') as ArtifactMeta['type'];
  const language = args.language ? String(args.language).slice(0, 24) : undefined;

  const artifact = ctx.store.createArtifact({
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    title,
    type,
    language,
    content,
  });
  const { content: _content, ...meta } = artifact;
  ctx.emit({ type: 'artifact', artifact: meta });

  return {
    content: JSON.stringify(
      {
        ok: true,
        artifact: {
          id: artifact.id,
          title: artifact.title,
          type: artifact.type,
          language: artifact.language,
          size: artifact.size,
        },
        note: 'Artifact saved and visible to the operator in the Artifacts panel. Do not paste the full content into chat; summarise it and refer to the artifact.',
      },
      null,
      2,
    ),
    summary: `Artifact · ${artifact.title}`,
    artifact: meta,
  };
}

/* ── System ─────────────────────────────────────────────────────── */

export async function getDatetimeTool(): Promise<ToolResult> {
  const date = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  const local = date.toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'long',
  });
  return {
    content: JSON.stringify(
      {
        iso: date.toISOString(),
        utc: date.toUTCString(),
        local,
        timezone,
        unix: Math.floor(date.getTime() / 1000),
      },
      null,
      2,
    ),
    summary: local,
  };
}

/* ── Human-in-the-loop ──────────────────────────────────────────── */

export async function askUserTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const question = String(args.question ?? '').trim();
  if (!question) throw new Error('Question is required.');
  if (question.length > 800) throw new Error('Question exceeds 800 characters.');
  const options = Array.isArray(args.options)
    ? args.options.map((option) => truncate(String(option), 120)).filter(Boolean).slice(0, 6)
    : undefined;
  const answer = await ctx.askUser(question, options);
  return {
    content: JSON.stringify(
      {
        question,
        answer,
        answeredAt: new Date().toISOString(),
        note: answer
          ? 'Use the operator answer to continue the mission.'
          : 'The operator did not answer. Proceed only with a clearly stated assumption, or pause.',
      },
      null,
      2,
    ),
    summary: answer ? 'Operator responded' : 'No operator response',
  };
}

export async function spawnAgentTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const agentRef = String(args.agent ?? 'oracle').trim();
  const task = String(args.task ?? '').trim();
  if (!task) throw new Error('A delegated task is required.');
  if (task.length > 4000) throw new Error('Delegated task exceeds 4,000 characters.');
  const maxSteps = Math.min(6, Math.max(1, Number(args.max_steps ?? 4)));
  const result = await ctx.spawnAgent(agentRef, task, maxSteps);
  return {
    content: JSON.stringify(
      {
        ok: true,
        agent: result.agent,
        callsign: result.callsign,
        result: result.result,
        steps: result.steps,
        artifacts: result.artifacts ?? [],
        note: 'The specialist has returned. Integrate its findings into your own answer and remain accountable for the final output.',
      },
      null,
      2,
    ),
    summary: `Subagent ${result.callsign} completed · ${result.steps} step(s)`,
    ...(result.artifactMeta ? { artifact: result.artifactMeta } : {}),
  };
}

/* ── Auto-extraction helper (used by runtime) ───────────────────── */

export function extractMemoryCandidate(input: string): string | null {
  const patterns = [
    /\bremember(?: that)?[:\s]+(.{8,600})/i,
    /\b(?:please\s+)?note that[:\s]+(.{8,600})/i,
    /\bkeep in mind(?: that)?[:\s]+(.{8,600})/i,
    /\bmy name is[:\s]+(.{2,120})/i,
    /\bI prefer[:\s]+(.{4,300})/i,
    /\bI(?:'m| am) working on[:\s]+(.{4,400})/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      let candidate = match[1].trim();
      candidate = candidate.replace(/^["'`]+|["'`]+$/g, '').trim();
      candidate = candidate.split(/\n{2,}/)[0]?.trim() ?? candidate;
      if (candidate.length >= 5 && !looksLikeSecret(candidate)) {
        if (pattern.source.includes('my name is')) return `Operator's name is ${candidate}.`;
        if (pattern.source.includes('I prefer')) return `Operator preference: ${candidate}.`;
        if (pattern.source.includes('working on')) return `Operator is working on: ${candidate}.`;
        return candidate;
      }
    }
  }
  return null;
}

export function makeMemoryFromInput(
  ctx: ToolContext,
  candidate: string,
): Memory {
  return ctx.store.addMemory({
    content: truncate(candidate, 800),
    tags: ['auto-extracted'],
    importance: 3,
    sourceSessionId: ctx.sessionId,
    sourceAgentId: ctx.agent.id,
  });
}

void now;
