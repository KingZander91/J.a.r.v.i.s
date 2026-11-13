import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import type {
  AgentEvent,
  AppSettings,
  Artifact,
  ProviderId,
} from '../shared/types';
import {
  CLIENT_DIST,
  IS_PRODUCTION,
  PORT,
  PROVIDERS,
  VERSION,
  WORKSPACE_DIR,
  isProviderId,
} from './config';
import { Store } from './store';
import { AgentRuntime } from './agent/runtime';
import { DemoProvider } from './agent/demo';
import { createProvider, ProviderError } from './agent/providers';
import { toolInfos } from './tools/registry';
import { looksLikeSecret } from './tools/cognition';
import { now, titleFromInput, truncate, uid } from './util';

const app = express();
const store = new Store();
const startedAt = Date.now();

interface ActiveRun {
  runtime: AgentRuntime;
  controller: AbortController;
  sessionId: string;
  agentId: string;
  startedAt: number;
}
const activeRuns = new Map<string, ActiveRun>();

app.disable('x-powered-by');
app.use(cors({ origin: true }));
app.use(express.json({ limit: '3mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const api = express.Router();

function publicBootstrap() {
  const stats = store.stats();
  stats.tools = toolInfos().length;
  return {
    agents: store.listAgents(),
    sessions: store.listSessions(),
    settings: store.getPublicSettings(),
    tools: toolInfos(),
    providerPresets: Object.values(PROVIDERS).map((preset) => ({
      id: preset.id as ProviderId,
      label: preset.label,
      baseUrl: preset.baseUrl,
      model: preset.model,
      keyRequired: preset.keyRequired,
      local: Boolean(preset.local),
      hint: preset.hint,
    })),
    stats,
    server: {
      version: VERSION,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      node: process.version,
      dataDir: store.getPublicSettings().dataDir,
    },
  };
}

api.get('/health', (_req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    provider: store.providerStatus(),
    activeRuns: activeRuns.size,
  });
});

api.get('/bootstrap', (_req, res) => {
  res.json(publicBootstrap());
});

/* ── Agents ─────────────────────────────────────────────────────── */

api.get('/agents', (_req, res) => {
  res.json({ agents: store.listAgents() });
});

api.post('/agents', (req, res) => {
  const body = req.body ?? {};
  if (!String(body.name ?? '').trim()) {
    res.status(400).json({ error: 'Agent name is required.' });
    return;
  }
  const agent = store.createAgent({
    name: String(body.name),
    callsign: String(body.callsign ?? body.name),
    description: String(body.description ?? ''),
    systemPrompt: String(body.systemPrompt ?? ''),
    accent: body.accent,
    icon: body.icon,
    tools: Array.isArray(body.tools) ? body.tools.map(String) : ['*'],
  });
  res.status(201).json({ agent });
});

api.patch('/agents/:id', (req, res) => {
  const agent = store.updateAgent(req.params.id, req.body ?? {});
  if (!agent) {
    res.status(404).json({ error: 'Agent not found.' });
    return;
  }
  res.json({ agent });
});

api.delete('/agents/:id', (req, res) => {
  const deleted = store.deleteAgent(req.params.id);
  if (!deleted) {
    res.status(400).json({ error: 'Built-in agents cannot be deleted.' });
    return;
  }
  res.json({ ok: true });
});

/* ── Sessions ───────────────────────────────────────────────────── */

api.get('/sessions', (_req, res) => {
  res.json({ sessions: store.listSessions() });
});

api.post('/sessions', (req, res) => {
  const agentId = String(req.body?.agentId ?? 'core');
  const title = req.body?.title ? String(req.body.title) : undefined;
  const session = store.createSession(agentId, title);
  res.status(201).json({ session });
});

api.get('/sessions/:id', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  res.json({ session, artifacts: store.listArtifacts(session.id) });
});

api.patch('/sessions/:id', (req, res) => {
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.agentId !== undefined) patch.agentId = String(body.agentId);
  if (body.pinned !== undefined) patch.pinned = Boolean(body.pinned);
  const session = store.updateSession(req.params.id, patch);
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  res.json({ session });
});

api.delete('/sessions/:id', (req, res) => {
  for (const [runId, run] of activeRuns) {
    if (run.sessionId === req.params.id) {
      run.controller.abort();
      activeRuns.delete(runId);
    }
  }
  const deleted = store.deleteSession(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  res.json({ ok: true });
});

api.get('/sessions/:id/export', (req, res) => {
  const markdown = store.exportSessionMarkdown(req.params.id);
  if (!markdown) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  const session = store.getSession(req.params.id)!;
  const filename = `${session.title.replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'jarvis-session'}.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(markdown);
});

/* ── Runs (SSE) ─────────────────────────────────────────────────── */

api.post('/sessions/:id/runs', async (req: Request, res: Response) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  const input = String(req.body?.input ?? '').trim();
  if (!input) {
    res.status(400).json({ error: 'Input is required.' });
    return;
  }
  if (input.length > 20_000) {
    res.status(400).json({ error: 'Input exceeds 20,000 characters.' });
    return;
  }
  const requestedAgent = req.body?.agentId ? String(req.body.agentId) : session.agentId;
  const agent = store.getAgent(requestedAgent);
  if (!agent) {
    res.status(400).json({ error: 'Unknown agent.' });
    return;
  }
  for (const run of activeRuns.values()) {
    if (run.sessionId === session.id) {
      res.status(409).json({ error: 'A run is already active for this session.' });
      return;
    }
  }

  if (session.agentId !== agent.id) {
    store.updateSession(session.id, { agentId: agent.id });
  }
  if (session.title === 'New session') {
    store.updateSession(session.id, { title: titleFromInput(input) });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let finished = false;
  let streamOpen = true;
  const runId = uid('run_');
  const controller = new AbortController();

  const emit = (event: AgentEvent) => {
    if (!streamOpen || res.writableEnded || res.destroyed) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      streamOpen = false;
    }
  };

  const heartbeat = setInterval(() => {
    if (!streamOpen || res.writableEnded || res.destroyed) return;
    try {
      res.write(': keepalive\n\n');
    } catch {
      streamOpen = false;
    }
  }, 15_000);

  res.on('close', () => {
    if (!finished) {
      streamOpen = false;
      controller.abort();
    }
  });

  let runtime: AgentRuntime;
  try {
    runtime = new AgentRuntime({
      store,
      sessionId: session.id,
      agentId: agent.id,
      runId,
      signal: controller.signal,
      emit,
    });
  } catch (error) {
    clearInterval(heartbeat);
    res.write(
      `data: ${JSON.stringify({ type: 'run_end', runId, status: 'failed', error: error instanceof Error ? error.message : String(error) })}\n\n`,
    );
    res.end();
    return;
  }

  activeRuns.set(runId, {
    runtime,
    controller,
    sessionId: session.id,
    agentId: agent.id,
    startedAt: now(),
  });

  try {
    await runtime.run(input);
  } catch (error) {
    console.error('[run] unhandled:', error);
    emit({
      type: 'run_end',
      runId,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    finished = true;
    clearInterval(heartbeat);
    activeRuns.delete(runId);
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
});

api.post('/runs/:runId/cancel', (req, res) => {
  const run = activeRuns.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Run is not active.' });
    return;
  }
  run.controller.abort();
  res.json({ ok: true });
});

api.post('/runs/:runId/approval/:approvalId', (req, res) => {
  const run = activeRuns.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Run is not active.' });
    return;
  }
  const approved = Boolean(req.body?.approved);
  const found = run.runtime.resolveApproval(req.params.approvalId, approved);
  if (!found) {
    res.status(404).json({ error: 'Approval request not found or already resolved.' });
    return;
  }
  res.json({ ok: true, approved });
});

api.post('/runs/:runId/question/:questionId', (req, res) => {
  const run = activeRuns.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Run is not active.' });
    return;
  }
  const answer = String(req.body?.answer ?? '').slice(0, 4000);
  const found = run.runtime.answerQuestion(req.params.questionId, answer);
  if (!found) {
    res.status(404).json({ error: 'Question not found or already answered.' });
    return;
  }
  res.json({ ok: true });
});

api.get('/runs', (_req, res) => {
  res.json({
    runs: [...activeRuns.entries()].map(([runId, run]) => ({
      runId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      startedAt: run.startedAt,
    })),
  });
});

/* ── Artifacts ──────────────────────────────────────────────────── */

api.get('/artifacts', (req, res) => {
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : undefined;
  res.json({ artifacts: store.listArtifacts(sessionId) });
});

api.get('/artifacts/:id', (req, res) => {
  const artifact = store.getArtifact(req.params.id);
  if (!artifact) {
    res.status(404).json({ error: 'Artifact not found.' });
    return;
  }
  res.json({ artifact });
});

api.delete('/artifacts/:id', (req, res) => {
  const deleted = store.deleteArtifact(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Artifact not found.' });
    return;
  }
  res.json({ ok: true });
});

/* ── Memories ───────────────────────────────────────────────────── */

api.get('/memories', (_req, res) => {
  res.json({ memories: store.listMemories() });
});

api.post('/memories', (req, res) => {
  const content = String(req.body?.content ?? '').trim();
  if (content.length < 3) {
    res.status(400).json({ error: 'Memory content is too short.' });
    return;
  }
  if (looksLikeSecret(content)) {
    res.status(400).json({ error: 'Refusing to store something that looks like a credential.' });
    return;
  }
  const memory = store.addMemory({
    content: content.slice(0, 1600),
    tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [],
    importance: Number(req.body?.importance ?? 3),
  });
  res.status(201).json({ memory });
});

api.patch('/memories/:id', (req, res) => {
  if (req.body?.content && looksLikeSecret(String(req.body.content))) {
    res.status(400).json({ error: 'Refusing to store something that looks like a credential.' });
    return;
  }
  const memory = store.updateMemory(req.params.id, {
    ...(req.body?.content !== undefined ? { content: String(req.body.content) } : {}),
    ...(Array.isArray(req.body?.tags) ? { tags: req.body.tags.map(String) } : {}),
    ...(req.body?.importance !== undefined ? { importance: Number(req.body.importance) } : {}),
  });
  if (!memory) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }
  res.json({ memory });
});

api.delete('/memories/:id', (req, res) => {
  const deleted = store.deleteMemory(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }
  res.json({ ok: true });
});

/* ── Settings & provider ───────────────────────────────────────── */

api.get('/settings', (_req, res) => {
  res.json({ settings: store.getPublicSettings() });
});

api.patch('/settings', (req, res) => {
  const body = req.body ?? {};
  const patch: Partial<AppSettings> = {};
  if (body.model && typeof body.model === 'object') {
    const model: Partial<AppSettings['model']> = {};
    if (body.model.provider !== undefined) {
      const provider = String(body.model.provider);
      if (!isProviderId(provider)) {
        res.status(400).json({ error: 'Unknown provider.' });
        return;
      }
      model.provider = provider as ProviderId;
    }
    if (body.model.model !== undefined) model.model = String(body.model.model).slice(0, 160);
    if (body.model.baseUrl !== undefined) model.baseUrl = String(body.model.baseUrl).slice(0, 500);
    if (body.model.temperature !== undefined) model.temperature = Number(body.model.temperature);
    if (body.model.maxTokens !== undefined) model.maxTokens = Number(body.model.maxTokens);
    patch.model = model as AppSettings['model'];
  }
  if (body.maxSteps !== undefined) patch.maxSteps = Number(body.maxSteps);
  if (body.autoMemory !== undefined) patch.autoMemory = Boolean(body.autoMemory);
  if (body.yoloMode !== undefined) patch.yoloMode = Boolean(body.yoloMode);
  if (body.approvalTimeoutMs !== undefined) patch.approvalTimeoutMs = Number(body.approvalTimeoutMs);
  if (body.systemPromptExtra !== undefined) {
    patch.systemPromptExtra = String(body.systemPromptExtra).slice(0, 4000);
  }
  const settings = store.updateSettings(patch);
  res.json({ settings: store.getPublicSettings(), applied: settings });
});

api.post('/settings/key', (req, res) => {
  const provider = String(req.body?.provider ?? '');
  if (!isProviderId(provider) || provider === 'demo') {
    res.status(400).json({ error: 'Invalid provider.' });
    return;
  }
  const rawKey = req.body?.key;
  if (rawKey === null || rawKey === '' || rawKey === undefined) {
    store.setProviderKey(provider, null);
    res.json({ ok: true, settings: store.getPublicSettings() });
    return;
  }
  const key = String(rawKey).trim();
  if (key.length < 8 || key.length > 500) {
    res.status(400).json({ error: 'Key length looks invalid.' });
    return;
  }
  store.setProviderKey(provider, key);
  res.json({ ok: true, settings: store.getPublicSettings() });
});

api.post('/settings/tavily', (req, res) => {
  const key = String(req.body?.key ?? '').trim();
  if (!key) {
    store.setTavilyKey(null);
    res.json({ ok: true, settings: store.getPublicSettings() });
    return;
  }
  if (key.length < 8 || key.length > 300) {
    res.status(400).json({ error: 'Tavily key length looks invalid.' });
    return;
  }
  store.setTavilyKey(key);
  res.json({ ok: true, settings: store.getPublicSettings() });
});

api.post('/provider/test', async (_req, res) => {
  const settings = store.getSettings();
  if (settings.model.provider === 'demo') {
    res.json({
      ok: true,
      latencyMs: 0,
      message: 'Simulation core operational. All tools are live.',
    });
    return;
  }
  const started = Date.now();
  try {
    const provider = createProvider({
      store,
      agentName: 'CORE',
      agentCallsign: 'CORE',
      demoProvider: new DemoProvider('CORE', 'CORE'),
    });
    const result = await provider.chat({
      messages: [
        { role: 'system', content: 'You are a connection diagnostic. Respond with exactly: OK' },
        { role: 'user', content: 'Connection test. Reply with OK.' },
      ],
      tools: [],
      signal: AbortSignal.timeout(45_000),
      agentName: 'test',
    });
    res.json({
      ok: true,
      latencyMs: Date.now() - started,
      message: truncate(result.text || 'Connected.', 300),
      model: settings.model.model,
    });
  } catch (error) {
    const message =
      error instanceof ProviderError
        ? error.hint
          ? `${error.message} ${error.hint}`
          : error.message
        : error instanceof Error
          ? error.message
          : String(error);
    res.json({ ok: false, latencyMs: Date.now() - started, message });
  }
});

/* ── Maintenance ────────────────────────────────────────────────── */

api.post('/data/reset', (req, res) => {
  if (String(req.body?.confirm ?? '') !== 'ERASE ALL DATA') {
    res.status(400).json({ error: 'Confirmation token missing.' });
    return;
  }
  if (activeRuns.size > 0) {
    res.status(409).json({ error: 'Cancel active runs before erasing data.' });
    return;
  }
  const removed = store.resetUserData();
  try {
    fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  } catch (error) {
    console.error('[maintenance] Failed to clear workspace:', error);
  }
  res.json({ ok: true, removed });
});

api.use((_req, res) => {
  res.status(404).json({ error: 'Unknown API route.' });
});

app.use('/api', api);

/* ── Static client (production) ─────────────────────────────────── */

if (IS_PRODUCTION && fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
  console.error('[server] unhandled error:', error);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

const server = app.listen(PORT, () => {
  const status = store.providerStatus();
  const line = '─'.repeat(54);
  console.log(`\n\x1b[38;5;49m${line}\x1b[0m`);
  console.log('  \x1b[1mJ.A.R.V.I.S. // AGENTIC CORE\x1b[0m');
  console.log(`  version ${VERSION} · node ${process.version}`);
  console.log(`  api      http://localhost:${PORT}/api`);
  console.log(`  provider ${status.label}${status.configured ? ' · READY' : ' · KEY REQUIRED'}`);
  console.log(`  tools    ${toolInfos().length} registered · workspace ./data/workspace`);
  console.log(`  mode     ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log(`\x1b[38;5;49m${line}\x1b[0m\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log('\n[core] Shutting down. Aborting active runs.');
    for (const run of activeRuns.values()) run.controller.abort();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}

// Keep the process alive if a provider stream hangs.
process.on('unhandledRejection', (reason) => {
  console.error('[core] Unhandled rejection:', reason);
});
