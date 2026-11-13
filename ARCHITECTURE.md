# Architecture

This document describes how J.A.R.V.I.S. is put together: process topology, data model, the agent runtime, the event protocol, the frontend state machine, and the places where the system is designed to be extended.

---

## 1. Design principles

1. **Local-first by default.** The app is useful with zero credentials. State lives in a local JSON store and a sandboxed workspace.
2. **Real side effects behind explicit gates.** The simulation core is scripted, but tools are not. Anything that executes code or writes files pauses for operator approval unless YOLO mode is deliberately enabled.
3. **The run is observable.** Plans, tokens, tool calls, delegations, approvals, memories and artifacts stream to the client as typed events. No hidden progress spinner.
4. **Fail honestly.** Provider errors, tool failures, cancellations and empty search results are surfaced verbatim. The agent is prompted not to fabricate success.
5. **One process, one operator.** The server is a single Express process with in-memory run coordination and a file-backed store. It is optimized for a personal workstation, not multi-tenant hosting.

---

## 2. Runtime topology

```
┌──────────────────────────────── Browser ───────────────────────────────┐
│  React 18 + Zustand                                                    │
│  TopBar · Sidebar · CoreView · ChatView · CognitionPanel              │
│  SettingsModal · AgentModal · ArtifactModal · ApprovalModal           │
│  Three.js Reactor · Web Speech API · localStorage prefs               │
└───────────────┬───────────────────────────────────────▲────────────────┘
                │ fetch JSON                     SSE    │
                ▼                                       │
┌──────────────────────────── Express ───────────────────┴───────────────┐
│  /api router                                                           │
│   ├─ Store ────────────── data/jarvis.json, secrets.json, workspace/   │
│   └─ activeRuns: Map<runId, { runtime, controller }>                   │
│         │                                                              │
│         ▼                                                              │
│  AgentRuntime                                                          │
│   ├─ Provider adapter  (Demo / OpenAI-compatible / Anthropic native)  │
│   ├─ Tool registry     (14 tools, approval metadata, timeouts)        │
│   ├─ Plan + memory + artifact services                                │
│   ├─ Approval / question promises                                     │
│   └─ Subagent loop     (read-only tools, depth 1)                     │
└────────────────────────────────────────────────────────────────────────┘
```

In development, Vite runs on `3000` and proxies `/api` to Express on `8787`. In production, Express serves `dist/` and the API on `8787`.

---

## 3. Directory map

```
server/
├── index.ts              HTTP routes, SSE transport, active-run registry, static serving
├── config.ts             paths, provider presets, env keys, version
├── store.ts              JSON persistence, settings, sessions, agents, memories, artifacts
├── seed.ts               built-in agent profiles
├── util.ts               ids, time, clamping, atomic writes, text helpers
├── agent/
│   ├── runtime.ts        the agent loop, tool execution, approvals, subagents, finalization
│   ├── providers.ts      provider factory, OpenAI-compatible + Anthropic adapters
│   ├── demo.ts           deterministic simulation core
│   └── prompt.ts         system prompt assembly and history trimming
└── tools/
    ├── registry.ts       tool definitions, JSON schemas, agent tool filtering, execution
    ├── research.ts       web search fallbacks, URL fetch with SSRF protection
    ├── compute.ts        calculator parser, vm JavaScript sandbox
    ├── files.ts          workspace path guards, list/read/write
    └── cognition.ts      plan, memory, artifacts, datetime, ask_user

shared/
├── types.ts              server ⇄ client contracts, AgentEvent union, settings
└── marvel.ts             built-in Marvel trivia shared by the demo provider and UI

src/
├── App.tsx               shell, shortcuts, modal mounting, boot gate
├── components/           React surfaces (Core, Channel, Cognition, overlays)
├── store/
│   ├── useAppStore.ts    server-backed state, SSE reducer, actions
│   └── prefsStore.ts     persisted theme/sound/motion/voice prefs
├── hooks/
│   ├── useSpeech.tsx     speechSynthesis provider
│   ├── useDictation.ts   SpeechRecognition
│   └── useNow.ts         ticking clock
├── lib/
│   ├── api.ts            typed fetch client + SSE parser
│   ├── types.ts          frontend-only view models
│   ├── accents.ts        theme → CSS variables
│   ├── prompts.ts        per-agent suggestion prompts
│   ├── sfx.ts            synthesized UI tones (Web Audio)
│   └── utils.ts          formatting, grouping, helpers
└── styles/               base, layout, core, session, overlays

scripts/
└── smoke.mjs             isolated end-to-end API harness
```

---

## 4. Data model

Defined in `shared/types.ts`.

| Entity | Key fields | Notes |
| --- | --- | --- |
| `AgentProfile` | id, name, callsign, description, systemPrompt, accent, icon, tools[] | Built-ins: core, oracle, forge, scribe, sentinel, ultron. `tools: ['*']` means all tools. Missing built-ins are restored on load without overwriting operator edits. |
| `Session` | id, title, agentId, messages[], plan[], artifacts[], usage, runCount, pinned | One channel = one session. Messages are final records, not stream deltas. |
| `ChatMessage` | role, content, createdAt, agent metadata, toolCalls[], artifacts[], usage, error, latencyMs | User or assistant. Assistant messages retain the complete tool trace. |
| `ToolCallRecord` | id, name, category, args, status, summary, resultPreview, error, timing | `args` and previews are truncated for storage/transport. |
| `PlanTask` | id, title, status, note | Status: pending, in_progress, done, failed, skipped. |
| `Memory` | id, content, tags[], importance 1–5, source session/agent | Retrieval is keyword-scored; relevant memories are injected into the system prompt. |
| `Artifact` | id, sessionId, runId, title, type, language, content, size | Metadata is listed in the UI; content is fetched on open. |
| `AppSettings` | model config, maxSteps, autoMemory, yoloMode, approvalTimeoutMs, systemPromptExtra, tool settings | Provider keys are **not** part of this object. |
| `PublicSettings` | AppSettings + providerStatus, keyStates, tavilyConfigured, dataDir, version | Safe to send to the browser. |

### Persistence

`data/jarvis.json` stores the entire database (`version`, settings, agents, sessions, memories, artifacts). `data/secrets.json` stores provider keys separately and is only created when a key is saved. Both are written through `atomicWrite`: write to a temporary file, `fsync`, then rename. File mode is `0600`.

The store loads defensively: missing fields are normalized, the core agent is recreated if absent, and a corrupt database falls back to a fresh one with an error log rather than crashing the server.

`data/workspace/` is the only directory exposed to file tools.

`POST /api/data/reset` is the destructive maintenance route used by **Settings → System → Delete all data**. It requires the body `{ "confirm": "ERASE ALL DATA" }`, returns `409` while any run is active, and otherwise clears sessions, memories, artifacts and custom agents in the store, then recreates an empty workspace. Settings and provider keys are intentionally kept; built-in agents are restored by the normal load path.

---

## 5. Agent runtime

`server/agent/runtime.ts` is the core of the system.

### 5.1 Run lifecycle

```
POST /api/sessions/:id/runs
  ├─ validate session, input, agent, no concurrent run for the session
  ├─ open SSE response
  ├─ create AgentRuntime + AbortController
  ├─ activeRuns.set(runId, ...)
  └─ await runtime.run(input)
        ├─ persist user message
        ├─ emit run_started
        ├─ clear + emit plan
        ├─ create provider (may fail → finalize failed)
        ├─ loop up to settings.maxSteps
        │    ├─ emit status thinking
        │    ├─ provider.chat(messages, tools, onToken)
        │    ├─ accumulate usage + stream assistant deltas
        │    ├─ if no tool calls → done
        │    ├─ execute tool calls sequentially
        │    │    ├─ parse arguments
        │    │    ├─ approval gate if required
        │    │    ├─ execute with timeout + cancellation
        │    │    └─ append tool result to message history
        │    └─ repeat
        └─ finalize(status)
```

`maxSteps` defaults to 12 and is clamped to 1–24. A step is one provider turn; a turn may contain multiple tool calls, which run sequentially.

### 5.2 Prompt construction

`buildSystemPrompt` combines:

- the agent's own system prompt,
- mission context (agent, session, local/UTC time, model, workspace path),
- the latest eight session artifact titles,
- the top five relevant memories retrieved by keyword scoring,
- an operating contract (plan first, ground claims, create artifacts, respect approvals, never fabricate, no hidden chain-of-thought),
- optional operator override text,
- YOLO/approval state.

History is trimmed to the last 18 messages and each message to 9,000 characters before being sent to a provider. Tool call records are **not** replayed as structured provider messages; only textual tool results are reconstructed from the persisted transcript context for this run.

### 5.3 Tool execution

Tools are looked up in the agent's filtered registry. For each call:

1. Arguments are parsed from the provider's JSON string. Invalid JSON produces a tool error result without throwing the run.
2. Unknown tools produce an error result listing available tools.
3. If `requiresApproval` and not YOLO, the run emits `approval` and awaits a promise. The HTTP layer resolves it via `/runs/:runId/approval/:approvalId`. Timeout or abort resolves as denied.
4. The tool executes with `withTimeout` (tool-specific, default 60s) and the run's abort signal.
5. Success updates the record with summary, preview, duration; failure records the error. Either way, a tool message is appended so the model can react.
6. Artifacts emitted by the tool are tracked as part of the final assistant message.

### 5.4 Finalization

`finalize` is idempotent. It:

- closes the plan (in-progress → done; pending → skipped on completion),
- builds the final assistant message from streamed text, tool records, artifacts, usage and latency,
- appends an honest status section for cancellation, failure or step-budget exhaustion,
- persists the message and increments the session run count,
- performs passive memory extraction when `autoMemory` is enabled and the run completed,
- denies/resolves any dangling approvals or questions,
- emits `run_end` with the persisted message.

The final message is persisted even on failure or cancellation, so reopening the channel shows what happened.

### 5.5 Subagents

`spawn_agent` runs a nested loop with:

- a specialist agent selected by id/name/callsign,
- a read-only tool subset (`safeToolsForAgent` minus delegation, planning, code execution, file writes and user questions),
- a maximum of 1–6 steps (capped at 6),
- its own system prompt with the delegation brief,
- the parent's abort signal.

The child emits only `artifact` and `memory` events to the UI, plus `subagent` started/finished events. Its summary is returned to the parent as a tool result. Nested delegation is rejected.

---

## 6. Providers

`server/agent/providers.ts` exposes a `LLMProvider` interface:

```ts
interface LLMProvider {
  id: string;
  label: string;
  simulated: boolean;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
```

Provider selection is `createProvider`:

- `demo` → `DemoProvider`, deterministic and tool-aware.
- `anthropic` → native Messages API adapter (system block, tool_use/tool_result blocks, usage mapping).
- everything else → OpenAI-compatible `/chat/completions` adapter with streaming and tool calls.

The OpenAI-compatible adapter supports base URL overrides, streaming SSE, function-call deltas, tool result messages, HTTP error mapping (`401/403`, `404`, `429` and generic), and request timeouts. The Anthropic adapter maps the same internal message/tool model to Anthropic's content-block format.

The provider factory receives the store so it can resolve keys with this priority: environment variable → saved secret → none. Local providers (Ollama, LM Studio, custom) do not require a key.

The simulation core is a separate provider that:

- classifies intent from the latest user text (greeting, memory, time, trivia, subagent, code, research, write, default),
- answers Marvel trivia from `shared/marvel.ts` without a network call, including follow-ups such as “more”,
- emits visible streamed text in small chunks,
- requests real tool calls (`web_search`, `run_javascript`, `create_artifact`, `save_memory`, `spawn_agent`, `update_plan`, `get_datetime`),
- reads tool results on later turns and produces a final answer.

This is why the app is fully demonstrable offline: orchestration, approvals, tools and persistence are production code; only the language decisions are scripted.

---

## 7. Tool layer

`server/tools/registry.ts` defines each tool with a name, category, description, JSON schema, approval flag, optional timeout and optional approval reason. `toolsForAgent` filters by `agent.tools`, `safeToolsForAgent` removes dangerous tools for subagents, and `executeTool` enforces cancellation and timeouts.

Safety properties:

- **Calculator**: hand-written recursive-descent parser, no `eval`, length and character allow-lists, finite-result check.
- **JavaScript**: `node:vm` context with `codeGeneration: { strings: false, wasm: false }`, no Node globals, 5s synchronous timeout, 8s total timeout, 24k-character cap, console capture only.
- **Workspace**: path normalization + prefix check against `WORKSPACE_DIR`; absolute paths and `..` escapes rejected; binary files refused; read/write size caps. Symlinks inside the workspace are not explicitly re-resolved, so keep the workspace directory trusted.
- **Research**: Tavily optional; parallel fallback sources; URL dedupe; DNS resolution and private-IP blocking; re-validation on every redirect; content-type and size limits.
- **Memory**: secret-pattern refusal, size caps, dedupe on explicit saves, keyword retrieval with importance/tag scoring.
- **Artifacts**: type allow-list, 380k character cap, metadata-only events over SSE.

Approval-gated tools are `run_javascript` and `workspace_write`. YOLO mode bypasses the prompt at the runtime level, not at the tool level, so tool behavior is unchanged.

---

## 8. Event protocol (SSE)

`POST /api/sessions/:id/runs` responds with `text/event-stream`. Each event is a JSON object prefixed with `data: ` and followed by a blank line. The server sends a `: keepalive` comment every 15 seconds.

| Event | Payload | Client effect |
| --- | --- | --- |
| `run_started` | runId, sessionId, agent, userMessage, simulated, model, startedAt | Replaces optimistic user message, initializes run |
| `status` | status, detail | Updates live run state and detail |
| `assistant_delta` | messageId, delta | Appends streamed text |
| `tool_call` | call | Adds a tool record |
| `tool_update` | callId, status, summary, preview, error, timing | Updates the tool record |
| `plan` | tasks[] | Replaces plan in run + session |
| `approval` | approval | Opens approval modal, pauses run |
| `approval_resolved` | approvalId, approved | Closes modal, updates status |
| `question` | question | Opens question modal |
| `question_resolved` | questionId | Closes question modal |
| `artifact` | artifact metadata | Adds artifact to library + run |
| `memory` | memory | Adds memory to library + run flash |
| `subagent` | phase, agentName, task, result | Adds delegation trace |
| `notice` | level, text | Adds notice; toast for warn/error |
| `run_end` | runId, status, message, error, usage, latency | Finalizes, refetches bootstrap/session/artifacts/memories |

If the stream closes without `run_end`, the client calls `recoverRun` to refetch persisted state and warns the operator.

### Cancellation, approvals, questions

While a run is active it is registered in `activeRuns`. The side-channel routes are:

- `POST /api/runs/:runId/cancel` → abort signal.
- `POST /api/runs/:runId/approval/:approvalId` → resolve pending approval.
- `POST /api/runs/:runId/question/:questionId` → resolve pending question.

The runtime cleans these up in `finally` and on `finalize`.

---

## 9. Frontend architecture

### 9.1 App shell

`App.tsx` mounts the ambient background, `TopBar`, `Sidebar`, either `CoreView` or `ChatView`, the optional `CognitionPanel`, global overlays, toasts and the boot screen. It also owns global shortcuts and applies the persisted accent theme and reduce-motion class.

The shell is CSS-grid based; sidebar collapse, cognition drawer and responsive breakpoints are handled with classes and CSS variables.

### 9.2 State

`useAppStore` (Zustand) is the server-backed state machine:

- bootstrap data: agents, sessions, settings, tools, presets, stats, server info,
- current view: `core` or `session`,
- active session + messages + plan,
- live run (`LiveRun` view model): status, streamed text, tool calls, plan, approvals, questions, subagents, notices, artifacts, memories, usage,
- UI overlays: settings, palette, agent editor, artifact, confirm dialog, sidebar/cognition open state.

Actions cover session CRUD, run launch/send/cancel, approval/question resolution, settings and key persistence, memory CRUD, artifact loading/deletion, agent CRUD, export and toasts.

`prefsStore` is persisted to `localStorage` under `jarvis.prefs.v1`: accent theme, sound, reduce motion, TTS, auto-speak and selected voice. Only presentation preferences live there; all operational state is server-owned.

### 9.3 Streaming

`streamRun` in `src/lib/api.ts` reads the fetch body, buffers by `\n\n`, parses each `data:` line and dispatches a typed `AgentEvent`. The store reduces each event into the live run or transcript. `run_end` triggers a refresh of bootstrap, session detail, artifacts and memories so the UI converges to the persisted truth.

Optimistic user messages are replaced by the server's message on `run_started`; if the stream fails before that, `recoverRun` reconciles the transcript.

### 9.4 Reactor

`components/Reactor.tsx` creates a raw Three.js scene (no react-three-fiber): a layered particle core, orbiting rings, lattice lines, starfield and bloom-like sprite. It reacts to accent changes, run status and reduce-motion. The HUD overlay (power draw, lattice, uptime, cores) is DOM, not canvas, so it stays crisp and accessible.

`components/CodeRain.tsx` layers a lightweight 2D canvas above the WebGL scene. Code-like columns (Stark/Ultron fragments mixed with random glyphs) fall between the reactor canvas and the vignette. It shares the accent and reduce-motion preferences, pauses offscreen, caps DPR at 2 and draws a single static frame when motion is reduced.

`CoreView` wraps the reactor panel with a Fullscreen API control. The panel (header, canvas and telemetry footer) enters fullscreen, the existing `ResizeObserver` reflows the renderer, and the control flips to an exit affordance. `Esc` is handled natively by the browser. If the API is unavailable or refuses the request, the UI reports it without disturbing the run.

The animation loop pauses when the tab is hidden and uses device-pixel-ratio clamping for performance.

### 9.5 Voice

- `useDictation` wraps `SpeechRecognition` with interim results, permission/error states and cleanup.
- `SpeechProvider` wraps `speechSynthesis`, exposes play/stop, tracks the spoken message id and cancels on channel change.
- Auto-speak is opt-in and only fires for newly completed assistant messages, never during streaming.

---

## 10. Security model

This is a personal local application, not a hardened multi-user service.

| Surface | Control |
| --- | --- |
| API access | None by default. Bind to localhost or place behind an authenticated reverse proxy before network exposure. |
| Provider keys | Separate file, `0600`, never returned to the client; env values take priority. |
| Code execution | Approval gate, `vm` isolation without Node globals, no code generation/WASM, timeouts and size caps. |
| File writes | Approval gate, workspace prefix guard, no absolute paths or traversal, size caps. |
| URL fetching | Protocol allow-list, DNS/private-IP blocking, redirect re-validation, content-type/size limits. |
| Memory | Secret-pattern refusal; memories are injected into prompts, so operators should not store sensitive data. |
| Destructive reset | Two-step UI confirmation plus a required body token; refuses while runs are active; preserves settings and keys. |
| XSS | Markdown is rendered through `marked` + DOMPurify. HTML artifacts preview inside a fully sandboxed iframe (`sandbox=""`); a source view is also available. |
| CORS | Enabled permissively for local development; restrict it if exposing the API. |

The `vm` module is not a security boundary against a determined adversary. Approval is the primary control; YOLO mode deliberately removes it.

---

## 11. Failure handling

- **Provider failure** → `run_end: failed` with a friendly hint, partial text preserved, tool records intact.
- **Tool error** → recorded on the tool call, returned to the model as `TOOL ERROR:`; the run continues.
- **Approval timeout/abort** → resolves as denied; the model sees `ACTION DENIED`.
- **Step budget** → `run_end: max_steps` with a warning notice and instructions.
- **Client disconnect** → server aborts the runtime, resolves pending decisions, persists nothing beyond what already completed.
- **Server restart** → persisted sessions survive; active runs do not. The UI recovers the session transcript.
- **Corrupt store** → logged and replaced with a fresh database; the server stays up.
- **Empty search** → explicit “no usable signal” response rather than fabrication.

---

## 12. Extension points

### Add a provider

1. Add a preset to `PROVIDERS` in `server/config.ts`.
2. If it is OpenAI-compatible, the existing adapter works; otherwise add a class in `server/agent/providers.ts` and branch in `createProvider`.
3. Add the env key to `ENV_KEYS` and `.env.example`.
4. The settings UI and bootstrap pick up presets automatically.

### Add a tool

1. Add a definition to `TOOL_DEFINITIONS` in `server/tools/registry.ts` with a JSON schema and approval flag.
2. Implement the handler in the relevant `server/tools/*` module.
3. If it produces an artifact or memory, emit the corresponding event through the context.
4. It appears in the tool registry, agent editor and system prompt automatically.

### Add an event

1. Extend the `AgentEvent` union in `shared/types.ts`.
2. Emit it from the runtime or a tool.
3. Handle it in `handleRunEvent` in `src/store/useAppStore.ts` and render it in the relevant component.

### Add an agent

Use the UI (**New intelligence**) or `POST /api/agents`. Select tools explicitly or use `*`. Built-in agents cannot be deleted, but they can be edited (except deletion), and custom agents can be removed when no session references them.

### Add a view or overlay

Mount it in `App.tsx`, add open/close state to `UIState` and the store, and add a shortcut branch if needed. Use the shared `Modal` component for focus trap, restore-focus and Escape handling.

---

## 13. Testing

- `npm run typecheck` — strict TypeScript across client, server and shared contracts.
- `npm run build` — typecheck plus production bundle.
- `npm run smoke` — spawns an isolated server with a temporary data directory and exercises the real API: bootstrap, memory, plan, approval, code execution, artifacts, delegation, research resilience, settings, export, destructive data reset and error paths.

The smoke harness intentionally tests the production tool paths, not mocks. It approves a real `run_javascript` gate and verifies the resulting artifact. Search assertions are network-tolerant so the harness remains useful offline.

---

## 14. Known limits

- Single process, single operator; no auth, rate limiting or tenant isolation.
- JSON store is rewritten atomically on each change; large histories (many thousands of messages) will eventually benefit from a real database.
- Provider history replay is textual; structured tool-call replay is intentionally clipped for portability across providers.
- The JavaScript sandbox is not a hardened container.
- File attachments are not connected to the runtime yet.
- The simulation core is a deterministic demo, not a general reasoning model.
- Public search endpoints can rate-limit; Tavily is the reliable path.
