#!/usr/bin/env node
/**
 * J.A.R.V.I.S. — isolated end-to-end smoke harness.
 *
 * Starts a throwaway server on a free port with a temporary data directory,
 * exercises the real HTTP/SSE API, then removes the temporary data. It never
 * touches the operator's data/ directory and requires no API keys.
 *
 *   npm run smoke
 *   JARVIS_SMOKE_VERBOSE=1 npm run smoke   # stream server logs
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = Boolean(process.env.JARVIS_SMOKE_VERBOSE);
const color = process.stdout.isTTY
  ? {
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      cyan: (s) => `\x1b[36m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
    }
  : {
      dim: (s) => s,
      green: (s) => s,
      red: (s) => s,
      cyan: (s) => s,
      bold: (s) => s,
    };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('Could not allocate a smoke-test port.'));
      });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    passed += 1;
    const suffix = detail ? color.dim(` — ${detail}`) : '';
    console.log(`  ${color.green('PASS')}  ${name}${suffix} ${color.dim(`(${Date.now() - started}ms)`)}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.log(`  ${color.red('FAIL')}  ${name}`);
    console.log(`        ${color.red(error instanceof Error ? error.message : String(error))}`);
  }
}

/* ── HTTP helpers ─────────────────────────────────────────────────── */

let base = '';

async function rawRequest(pathname, init = {}) {
  const headers = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
  let response;
  try {
    response = await fetch(`${base}${pathname}`, { ...init, headers });
  } catch (error) {
    throw new Error(
      `Could not reach ${pathname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body, text };
}

async function api(pathname, init = {}) {
  const { response, body } = await rawRequest(pathname, init);
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && body.error ? body.error : JSON.stringify(body);
    throw new Error(`${init.method ?? 'GET'} ${pathname} → HTTP ${response.status}: ${detail}`);
  }
  return body;
}

const jsonBody = (value) => JSON.stringify(value);

/* ── SSE run helper ───────────────────────────────────────────────── */

/**
 * Stream a run to completion. Approvals are auto-approved unless
 * autoApprove is false or a custom onApproval handler is supplied.
 */
async function runPrompt(sessionId, input, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  const response = await fetch(`${base}/sessions/${sessionId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: jsonBody({ input }),
    signal: controller.signal,
  }).catch((error) => {
    clearTimeout(timeout);
    throw new Error(`Run stream failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  if (!response.ok) {
    clearTimeout(timeout);
    const text = await response.text();
    throw new Error(`POST /sessions/${sessionId}/runs → HTTP ${response.status}: ${text}`);
  }
  if (!response.body) {
    clearTimeout(timeout);
    throw new Error('Run stream returned an empty body.');
  }

  const events = [];
  const approvals = [];
  let runId = '';
  let streamError = null;

  const dispatch = async (block) => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const event = JSON.parse(payload);
      events.push(event);

      if (event.type === 'run_started') {
        runId = event.runId;
      }
      if (event.type === 'approval') {
        approvals.push(event.approval);
        if (options.onApproval) {
          await options.onApproval(event.approval, event.approval.runId || runId);
        } else if (options.autoApprove !== false) {
          const target = event.approval.runId || runId;
          const approved = await fetch(`${base}/runs/${target}/approval/${event.approval.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: jsonBody({ approved: true }),
          });
          if (!approved.ok) {
            throw new Error(`Approval failed with HTTP ${approved.status}.`);
          }
        }
      }
      if (event.type === 'question' && options.answerQuestion) {
        await options.answerQuestion(event.question, event.question.runId || runId);
      }
    }
  };

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        await dispatch(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) await dispatch(buffer);
  } catch (error) {
    streamError = error;
  } finally {
    clearTimeout(timeout);
  }

  if (streamError) {
    if (streamError.name === 'AbortError') {
      throw new Error(`Run timed out after ${options.timeoutMs ?? 120_000}ms.`);
    }
    throw streamError;
  }

  const runEnd = [...events].reverse().find((event) => event.type === 'run_end');
  return { events, approvals, runEnd, runId };
}

function runCompleted(result) {
  assert(result.runEnd, 'run never emitted run_end');
  assertEqual(result.runEnd.status, 'completed', 'run status');
  assert(result.runEnd.message, 'run_end did not include the persisted assistant message');
}

function toolResult(events, name) {
  const calls = events.filter((event) => event.type === 'tool_call' && event.call.name === name);
  if (!calls.length) return { call: null, status: 'missing' };
  const last = calls[calls.length - 1].call;
  const updates = events.filter(
    (event) => event.type === 'tool_update' && event.callId === last.id,
  );
  const update = updates[updates.length - 1];
  return {
    call: last,
    update,
    status: update?.status ?? last.status,
  };
}

/* ── Main ─────────────────────────────────────────────────────────── */

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jarvis-smoke-'));
const port = await freePort();
base = `http://127.0.0.1:${port}/api`;

console.log('');
console.log(color.bold(color.cyan('J.A.R.V.I.S. // SMOKE HARNESS')));
console.log(color.dim(`  data   ${tempDir}`));
console.log(color.dim(`  api    ${base}`));
console.log('');

let server = null;
let serverLogs = '';

function captureServerLog(chunk) {
  const text = chunk.toString();
  serverLogs += text;
  if (serverLogs.length > 12_000) serverLogs = serverLogs.slice(-12_000);
  if (VERBOSE) process.stdout.write(color.dim(text));
}

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      JARVIS_DATA_DIR: tempDir,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', captureServerLog);
  server.stderr.on('data', captureServerLog);
  server.once('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(color.red(`\n  Core server exited early with code ${code}.`));
    }
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Core server exited during startup (code ${server.exitCode}).\n${serverLogs}`);
    }
    try {
      const health = await fetch(`${base}/health`);
      if (health.ok) return;
    } catch {
      /* not ready yet */
    }
    await sleep(250);
  }
  throw new Error(`Core server did not become ready within 30s.\n${serverLogs}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit').catch(() => null), sleep(4000)]);
  if (server.exitCode === null) {
    server.kill('SIGKILL');
    await Promise.race([once(server, 'exit').catch(() => null), sleep(2000)]);
  }
}

let sessionId = '';
let codeArtifactId = '';
let writeArtifactId = '';

try {
  await startServer();
  console.log(color.dim('  server ready\n'));

  await check('health and simulation provider', async () => {
    const health = await api('/health');
    assertEqual(health.ok, true, 'health.ok');
    assert(health.provider, 'health.provider is missing');
    assertEqual(health.provider.demo, true, 'provider.demo');
    assertEqual(health.activeRuns, 0, 'activeRuns');
    return `${health.provider.label} · ${health.version}`;
  });

  await check('bootstrap exposes agents, tools and presets', async () => {
    const bootstrap = await api('/bootstrap');
    assert(bootstrap.agents.length >= 5, 'expected at least five built-in agents');
    assertEqual(bootstrap.tools.length, 14, 'tool count');
    assertEqual(bootstrap.settings.model.provider, 'demo', 'default provider');
    assert(
      bootstrap.providerPresets.some((preset) => preset.id === 'anthropic'),
      'Anthropic preset missing',
    );
    assert(
      bootstrap.agents.some((agent) => agent.id === 'core' && agent.tools.includes('*')),
      'core agent missing or not fully privileged',
    );
    return `${bootstrap.agents.length} agents · ${bootstrap.tools.length} tools`;
  });

  await check('provider diagnostic (demo)', async () => {
    const result = await api('/provider/test', { method: 'POST' });
    assertEqual(result.ok, true, 'test.ok');
    assert(result.latencyMs >= 0, 'latency missing');
    return result.message;
  });

  await check('create channel', async () => {
    const created = await api('/sessions', {
      method: 'POST',
      body: jsonBody({ agentId: 'core' }),
    });
    sessionId = created.session.id;
    assert(sessionId, 'session id missing');
    assertEqual(created.session.agentId, 'core', 'session agent');
    return sessionId;
  });

  await check('built-in Ultron and Marvel trivia answer offline', async () => {
    const bootstrap = await api('/bootstrap');
    const ultron = bootstrap.agents.find((agent) => agent.id === 'ultron');
    assert(ultron, 'Ultron built-in agent missing');
    assertEqual(ultron.builtin, true, 'Ultron builtin flag');

    const created = await api('/sessions', {
      method: 'POST',
      body: jsonBody({ agentId: 'ultron' }),
    });
    const result = await runPrompt(
      created.session.id,
      'Tell me Marvel trivia about Ultron and the Infinity Stones.',
    );
    runCompleted(result);
    const content = result.runEnd.message.content;
    assert(/Marvel archive/i.test(content), 'trivia header missing');
    assert(/Ultron/i.test(content), 'Ultron fact missing');
    assert(/Infinity Stones/i.test(content), 'Infinity Stones fact missing');
    assert(!toolResult(result.events, 'web_search').call, 'trivia should not call web_search');
    const facts = content.match(/^- \*\*/gm)?.length ?? 0;
    assert(facts >= 2, 'expected at least two trivia entries');

    const vision = await runPrompt(created.session.id, 'Who make vision?');
    runCompleted(vision);
    assert(/Vision/i.test(vision.runEnd.message.content), 'Vision trivia missing');
    assert(
      /Ultron built Vision|MCU version is assembled/i.test(vision.runEnd.message.content),
      'Vision origin fact missing',
    );
    assert(!toolResult(vision.events, 'web_search').call, 'Vision trivia should not search');
    return `${ultron.callsign} · ${facts} built-in facts · Vision origin resolved`;
  });

  await check('memory tool persists durable memory', async () => {
    const result = await runPrompt(
      sessionId,
      'Remember that the smoke test prefers deterministic briefings with sources.',
    );
    runCompleted(result);
    const save = toolResult(result.events, 'save_memory');
    assertEqual(save.status, 'success', 'save_memory status');
    const memories = await api('/memories');
    assert(
      memories.memories.some((memory) => /smoke test prefers deterministic briefings/i.test(memory.content)),
      'saved memory not found in the memory index',
    );
    return `${memories.memories.length} memories indexed`;
  });

  await check('code run pauses for approval, executes and creates artifact', async () => {
    const result = await runPrompt(
      sessionId,
      'Write and run a JavaScript function that finds all prime numbers below 100.',
    );
    runCompleted(result);
    assert(result.approvals.length >= 1, 'no approval gate was emitted for run_javascript');
    assert(
      !/```json\s*undefined\b/i.test(result.runEnd.message.content),
      'code run rendered literal undefined as its observed output',
    );
    const js = toolResult(result.events, 'run_javascript');
    assertEqual(js.status, 'success', 'run_javascript status');
    assert(
      result.events.some((event) => event.type === 'plan' && event.tasks.length > 0),
      'plan events were never populated',
    );
    const artifactEvent = result.events.find((event) => event.type === 'artifact');
    assert(artifactEvent, 'code artifact event missing');
    codeArtifactId = artifactEvent.artifact.id;
    const artifact = await api(`/artifacts/${codeArtifactId}`);
    assertEqual(artifact.artifact.type, 'code', 'artifact type');
    assert(
      /execution output/i.test(artifact.artifact.content),
      'artifact does not contain execution output',
    );
    return `${result.approvals.length} gate · ${artifact.artifact.title}`;
  });

  await check('write run creates a downloadable markdown artifact', async () => {
    const result = await runPrompt(
      sessionId,
      'Write a 5-day launch plan for a local AI command center and save it as an artifact.',
    );
    runCompleted(result);
    const create = toolResult(result.events, 'create_artifact');
    assertEqual(create.status, 'success', 'create_artifact status');
    const artifactEvent = [...result.events].reverse().find((event) => event.type === 'artifact');
    assert(artifactEvent, 'markdown artifact event missing');
    writeArtifactId = artifactEvent.artifact.id;
    assertEqual(artifactEvent.artifact.type, 'markdown', 'artifact type');
    const artifact = await api(`/artifacts/${writeArtifactId}`);
    assert(artifact.artifact.content.length > 400, 'artifact content is suspiciously short');
    return `${artifact.artifact.size} bytes`;
  });

  await check('specialist delegation runs read-only and reports back', async () => {
    const result = await runPrompt(
      sessionId,
      'Delegate a research task to ORACLE about the current state of open-source AI agents.',
    );
    runCompleted(result);
    const spawn = toolResult(result.events, 'spawn_agent');
    assertEqual(spawn.status, 'success', 'spawn_agent status');
    assert(
      result.events.some((event) => event.type === 'subagent' && event.phase === 'started'),
      'subagent start event missing',
    );
    assert(
      result.events.some((event) => event.type === 'subagent' && event.phase === 'finished'),
      'subagent finish event missing',
    );
    return 'ORACLE returned a scoped brief';
  });

  await check('research retrieves sources or fails honestly', async () => {
    const result = await runPrompt(
      sessionId,
      'Research the current state of open-source AI agents and brief me with sources.',
    );
    runCompleted(result);
    const search = toolResult(result.events, 'web_search');
    assert(search.call, 'web_search was never attempted');
    const artifact = [...result.events].reverse().find((event) => event.type === 'artifact');
    const message = result.runEnd.message?.content ?? '';
    if (search.status === 'success' && artifact) {
      const stored = await api(`/artifacts/${artifact.artifact.id}`);
      assert(/## Sources/i.test(stored.artifact.content), 'research brief is missing a sources section');
      return 'sourced brief compiled';
    }
    if (search.status === 'success') {
      assert(
        /no usable signal|no results|retrieval/i.test(message),
        'empty retrieval was not reported honestly',
      );
      return 'empty sweep reported honestly';
    }
    assert(search.status === 'error', `unexpected web_search status: ${search.status}`);
    assert(
      /fail|error|unavailable|signal/i.test(message),
      'search failure was not reported in the final answer',
    );
    return 'retrieval outage handled gracefully';
  });

  await check('denied execution is not reported as verified', async () => {
    const deniedSession = (
      await api('/sessions', {
        method: 'POST',
        body: jsonBody({ agentId: 'core', title: 'Denied execution smoke test' }),
      })
    ).session;
    const result = await runPrompt(
      deniedSession.id,
      'Write and run a JavaScript function that checks for palindromes.',
      {
        autoApprove: false,
        onApproval: async (approval, runId) => {
          const denied = await fetch(
            `${base}/runs/${runId}/approval/${approval.id}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: jsonBody({ approved: false }),
            },
          );
          assert(denied.ok, `denial failed with HTTP ${denied.status}`);
        },
      },
    );
    runCompleted(result);
    const content = result.runEnd.message.content;
    assert(!/Execution verified/i.test(content), 'denied run claimed execution succeeded');
    assert(!/saved in \*\*Artifacts\*\*/i.test(content), 'denied run claimed an artifact');
    assert(
      !result.events.some((event) => event.type === 'artifact'),
      'denied run emitted an artifact',
    );
    assert(/Authorization denied/i.test(content), 'denial was not reported to the operator');
    return 'denied execution stops cleanly';
  });

  await check('run cancellation resolves the gate and preserves partial state', async () => {
    const result = await runPrompt(
      sessionId,
      'Write and run a JavaScript function that computes the Fibonacci sequence.',
      {
        autoApprove: false,
        onApproval: async (approval, runId) => {
          const cancelled = await api(`/runs/${runId}/cancel`, { method: 'POST' });
          assertEqual(cancelled.ok, true, 'cancel response');
        },
      },
    );
    assert(result.runEnd, 'cancelled run did not emit run_end');
    assertEqual(result.runEnd.status, 'cancelled', 'cancelled run status');
    assert(
      result.events.some(
        (event) => event.type === 'approval_resolved' && event.approved === false,
      ),
      'pending approval was not resolved as denied',
    );
    return 'stop signal aborted the run cleanly';
  });

  await check('YOLO mode bypasses approval gates', async () => {
    await api('/settings', {
      method: 'PATCH',
      body: jsonBody({ yoloMode: true }),
    });
    const result = await runPrompt(
      sessionId,
      'Write and run a JavaScript function that sorts an array of numbers.',
      { autoApprove: false },
    );
    runCompleted(result);
    assertEqual(result.approvals.length, 0, 'approval emitted despite YOLO mode');
    const js = toolResult(result.events, 'run_javascript');
    assertEqual(js.status, 'success', 'run_javascript status');
    await api('/settings', {
      method: 'PATCH',
      body: jsonBody({ yoloMode: false }),
    });
    return 'gate bypass honored, then restored';
  });

  await check('session detail and Markdown export', async () => {
    const detail = await api(`/sessions/${sessionId}`);
    assertEqual(detail.session.id, sessionId, 'session.id');
    assert(detail.session.messages.length >= 8, 'expected at least eight persisted messages');
    assert(detail.session.plan.length > 0, 'persisted plan missing');
    assert(detail.session.artifacts.length >= 2, 'session artifact links missing');

    const exported = await rawRequest(`/sessions/${sessionId}/export`);
    assertEqual(exported.response.status, 200, 'export status');
    assert(
      /text\/markdown/.test(exported.response.headers.get('content-type') ?? ''),
      'export content type',
    );
    assert(exported.text.includes('J.A.R.V.I.S.'), 'export does not contain the transcript');
    assert(exported.text.length > 800, 'export is suspiciously short');
    return `${detail.session.messages.length} messages · ${exported.text.length} bytes exported`;
  });

  await check('memory CRUD including secret rejection', async () => {
    const created = await api('/memories', {
      method: 'POST',
      body: jsonBody({
        content: 'Smoke memory cell for CRUD verification.',
        tags: ['smoke'],
        importance: 2,
      }),
    });
    const id = created.memory.id;
    const patched = await api(`/memories/${id}`, {
      method: 'PATCH',
      body: jsonBody({ importance: 5, tags: ['smoke', 'verified'] }),
    });
    assertEqual(patched.memory.importance, 5, 'patched importance');
    assert(patched.memory.tags.includes('verified'), 'patched tags missing');

    const secret = await rawRequest('/memories', {
      method: 'POST',
      body: jsonBody({ content: `sk-${'a'.repeat(32)}` }),
    });
    assertEqual(secret.response.status, 400, 'secret memory rejection status');

    await api(`/memories/${id}`, { method: 'DELETE' });
    const memories = await api('/memories');
    assert(!memories.memories.some((memory) => memory.id === id), 'memory was not deleted');
    return 'create · patch · reject secret · delete';
  });

  await check('agent CRUD respects built-in protection', async () => {
    const created = await api('/agents', {
      method: 'POST',
      body: jsonBody({
        name: 'Smoke Analyst',
        callsign: 'SMOKE',
        description: 'Temporary agent created by the smoke harness.',
        tools: ['get_datetime', 'calculator'],
      }),
    });
    const id = created.agent.id;
    assertEqual(created.agent.builtin, false, 'custom agent builtin flag');

    const patched = await api(`/agents/${id}`, {
      method: 'PATCH',
      body: jsonBody({ description: 'Updated by smoke harness.' }),
    });
    assertEqual(patched.agent.description, 'Updated by smoke harness.', 'patched description');

    const builtinDelete = await rawRequest('/agents/core', { method: 'DELETE' });
    assertEqual(builtinDelete.response.status, 400, 'built-in deletion status');

    const deleted = await api(`/agents/${id}`, { method: 'DELETE' });
    assertEqual(deleted.ok, true, 'agent delete');
    return 'create · patch · protect built-in · delete';
  });

  await check('settings validation and persistence', async () => {
    const patched = await api('/settings', {
      method: 'PATCH',
      body: jsonBody({
        maxSteps: 8,
        model: { temperature: 0.5 },
      }),
    });
    assertEqual(patched.settings.maxSteps, 8, 'maxSteps');
    assertEqual(patched.settings.model.temperature, 0.5, 'temperature');

    const invalid = await rawRequest('/settings', {
      method: 'PATCH',
      body: jsonBody({ model: { provider: 'not-a-provider' } }),
    });
    assertEqual(invalid.response.status, 400, 'unknown provider rejection status');
    return 'valid patch persisted · invalid provider rejected';
  });

  await check('artifact library and deletion', async () => {
    const listed = await api('/artifacts');
    assert(listed.artifacts.length >= 2, 'expected at least two artifacts');
    assert(
      listed.artifacts.some((artifact) => artifact.id === codeArtifactId),
      'code artifact missing from library',
    );
    const removed = await api(`/artifacts/${writeArtifactId}`, { method: 'DELETE' });
    assertEqual(removed.ok, true, 'artifact delete');
    const missing = await rawRequest(`/artifacts/${writeArtifactId}`);
    assertEqual(missing.response.status, 404, 'deleted artifact status');
    return `${listed.artifacts.length} listed · deletion verified`;
  });

  await check('delete all data erases content and preserves configuration', async () => {
    const denied = await rawRequest('/data/reset', {
      method: 'POST',
      body: jsonBody({ confirm: 'wrong token' }),
    });
    assertEqual(denied.response.status, 400, 'missing-token rejection status');

    const custom = await api('/agents', {
      method: 'POST',
      body: jsonBody({
        name: 'Reset Probe',
        callsign: 'PROBE',
        description: 'Should not survive the reset.',
        tools: ['get_datetime'],
      }),
    });
    await mkdir(path.join(tempDir, 'workspace'), { recursive: true });
    await writeFile(path.join(tempDir, 'workspace', 'erase-me.txt'), 'temporary smoke file');

    const before = await api('/bootstrap');
    assert(before.sessions.length > 0, 'expected sessions before reset');
    assert(before.stats.artifacts > 0, 'expected artifacts before reset');
    assert(before.stats.memories > 0, 'expected memories before reset');

    const result = await api('/data/reset', {
      method: 'POST',
      body: jsonBody({ confirm: 'ERASE ALL DATA' }),
    });
    assertEqual(result.ok, true, 'reset response');
    assert(result.removed.sessions >= 2, 'reset did not report erased sessions');
    assert(result.removed.agents >= 1, 'reset did not report erased custom agents');

    const after = await api('/bootstrap');
    assertEqual(after.sessions.length, 0, 'sessions after reset');
    assertEqual(after.stats.memories, 0, 'memories after reset');
    assertEqual(after.stats.artifacts, 0, 'artifacts after reset');
    assertEqual(after.stats.runs, 0, 'runs after reset');
    assert(
      after.agents.every((agent) => agent.builtin || agent.id === 'core'),
      'non-built-in agents survived the reset',
    );
    assert(
      !after.agents.some((agent) => agent.id === custom.agent.id),
      'custom agent survived the reset',
    );
    assertEqual(after.settings.maxSteps, 8, 'settings were not preserved');
    const workspaceFiles = await readdir(path.join(tempDir, 'workspace'));
    assertEqual(workspaceFiles.length, 0, 'workspace was not cleared');
    return `${result.removed.sessions} channels · ${result.removed.memories} memories erased`;
  });

  await check('unknown routes return structured 404', async () => {
    const missing = await rawRequest('/definitely-not-a-route');
    assertEqual(missing.response.status, 404, 'unknown route status');
    assert(missing.body && missing.body.error, 'unknown route did not return an error object');
    return missing.body.error;
  });
} catch (error) {
  failed += 1;
  failures.push({ name: 'harness', error });
  console.error(color.red(`\n  Harness error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
  if (serverLogs) console.error(color.dim(serverLogs));
} finally {
  await stopServer();
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}

console.log('');
const total = passed + failed;
if (failures.length) {
  console.log(color.red(color.bold(`  ${failed} of ${total} checks failed.`)));
  for (const failure of failures) {
    console.log(
      color.red(`  · ${failure.name}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`),
    );
  }
  process.exitCode = 1;
} else {
  console.log(color.green(color.bold(`  All ${total} checks passed.`)));
  console.log(color.dim('  Temporary data removed; operator data untouched.'));
}
console.log('');
