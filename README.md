# J.A.R.V.I.S. — Agentic Command Core

A local-first agentic AI command center with a holographic reactor interface.

J.A.R.V.I.S. is not a chat window with a sci-fi skin. Every mission gets a visible plan, a real tool bus, durable memory, approval gates, downloadable artifacts and optional specialist subagents. The browser shows the run as it happens over a streaming event feed.

The reactor visual language is inspired by the open-source `jarvis-ui` project, but the interface, runtime and tool layer are rebuilt from scratch in this repository.

> **Works with no API key.** The built-in **Simulation Core** is a deterministic local agent. It still calls real tools — live search, the JavaScript sandbox, file I/O, memory, artifacts and subagents are genuine. Only language synthesis is scripted. Connect a model at any time in **Settings → Neural Link** for full reasoning.

---

## Quick start

Requirements: **Node.js 20.6+** and npm.

```bash
npm install
npm run dev
```

Open **http://localhost:3000**.

This starts both processes:

| Process | URL | Purpose |
| --- | --- | --- |
| Express core | `http://localhost:8787` | API, SSE run stream, persistence |
| Vite client | `http://localhost:3000` | React interface with `/api` proxy |

Production build:

```bash
npm run build
npm start
```

Open **http://localhost:8787**. The production server serves the built client and API from one process.

### First mission

1. On the **Core**, choose an intelligence (CORE, ORACLE, FORGE, SCRIBE, SENTINEL, ULTRON) or create your own.
2. Type an objective, for example:
   - *Research the current state of open-source AI agents and brief me with sources.*
   - *Write and run a JavaScript function that finds all primes below 100.*
   - *Write a 5-day launch plan and save it as an artifact.*
   - *Remember that I prefer concise technical briefs with sources.*
   - *Delegate a research task to ORACLE about small language models.*
3. Press **Initiate mission** (or `Ctrl/Cmd + Enter`).

The app opens a secure channel. The plan, live tokens, tool calls, approvals, delegations, memories and artifacts appear in real time.

---

## What is actually agentic

- **Planning** — the model can replace a visible task plan at any step. The operator sees progress rather than a spinner.
- **Tool use** — 14 tools cover retrieval, compute, files, memory, artifacts, human questions and delegation.
- **Human-in-the-loop** — `run_javascript` and `workspace_write` pause for explicit approval. Countdown, argument payload and purpose are shown before authorization.
- **Durable memory** — explicit saves and passive preference extraction persist across channels. Relevant memories are retrieved into the next system prompt.
- **Artifacts** — substantial deliverables are stored separately from chat and can be viewed, copied or downloaded.
- **Subagents** — CORE can delegate scoped work to a specialist. Subagents run with a read-only tool boundary and cannot delegate further.
- **Recovery** — if the stream drops, the client can recover the persisted session; if a run is stopped or fails, partial output and tool history are preserved with an honest status.
- **Stop control** — cancel an active run from the live card or composer. Cancellation aborts tools and resolves pending approvals safely.

---

## Interface tour

### Core

The landing command center: animated Three.js reactor, system telemetry, agent deck, recent channels and a mission brief. Accent themes (teal, cyan, amber, violet, rose) recolor the reactor, HUD and controls. The reactor header has a fullscreen control; the canvas reflows to the display and `Esc` returns to the HUD. A live code-rain layer of half-garbled Stark/Ultron fragments falls behind the reactor, and the **Stark archive** ticker above the grid rotates built-in Marvel trivia.

The agent deck ships with six built-ins. **ULTRON** is a rose-accented adversarial intelligence and Marvel canon archivist; in simulation mode he answers trivia from the local archive and speaks with appropriate disdain for sloppy continuity.

### Channel

Each channel is a persisted session with an agent, transcript, plan, tool trace and artifacts. The header shows the channel id, active intelligence, transmission count and artifact count. Titles can be renamed inline and pinned in the sidebar.

### Cognition panel

The right-hand deck has four tabs:

- **Cognition** — live plan, current run status, memories saved during the run and artifact output.
- **Memory** — search, add, inspect and delete durable memory cells.
- **Artifacts** — browse channel artifacts or the whole library; open, copy or download.
- **System** — provider/model state, tool registry, authority mode and runtime facts.

Toggle it with `Ctrl/Cmd + J`.

### Command palette

Press `Ctrl/Cmd + K` for actions: new channel, open core, settings, agents, recent sessions, theme changes and memory/artifact jumps. Type to filter, arrow keys to move, Enter to execute.

### Voice

- **Dictation** uses the browser Web Speech API when available.
- **Speech output** uses `speechSynthesis`; enable it under **Settings → Interface**, then use the **Speak** control on a message or let auto-speak read completed answers.
- Voice is optional and local to the browser. No audio leaves the machine.

---

## Providers

Choose a provider in **Settings → Neural Link**. API keys can also be supplied through `.env`; environment keys take priority over saved keys.

| Provider | Mode | Default model | Key |
| --- | --- | --- | --- |
| Simulation Core | Deterministic local agent | `jarvis-sim-1` | Not required |
| OpenAI | OpenAI-compatible | `gpt-4o-mini` | Required |
| Anthropic | Native Messages API | `claude-sonnet-4-20250514` | Required |
| OpenRouter | OpenAI-compatible | `openai/gpt-4o-mini` | Required |
| Groq | OpenAI-compatible | `llama-3.3-70b-versatile` | Required |
| DeepSeek | OpenAI-compatible | `deepseek-chat` | Required |
| Mistral | OpenAI-compatible | `mistral-large-latest` | Required |
| Ollama | Local OpenAI-compatible | `llama3.2` | Not required |
| LM Studio | Local OpenAI-compatible | `local-model` | Not required |
| Custom endpoint | Any OpenAI-compatible `/chat/completions` | `model-id` | Optional |

The connection test saves the current draft and sends a minimal completion request. Model IDs and base URLs are editable, so any compatible endpoint works.

### Environment keys

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

```dotenv
PORT=8787
JARVIS_DATA_DIR=./data

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
DEEPSEEK_API_KEY=
MISTRAL_API_KEY=

# Optional — improves live web search
TAVILY_API_KEY=
```

Keys saved through the UI are written to `data/secrets.json` with owner-only permissions (`0600`). Keys are never returned to the browser after saving; the UI only receives a `saved`/`missing`/`env` state.

### Deploy on Vercel

The repository ships with a Vercel configuration:

- `api/index.ts` exports the Express app as one Node.js function.
- `vercel.json` builds the Vite client into `dist/` and rewrites every `/api/*` request to that function.
- SSE streaming is enabled by default on Vercel’s Node.js runtime, so plans, tokens and tool events stream normally.

Import the GitHub repository into Vercel, or run:

```bash
npx vercel
```

Add provider keys as **Vercel Environment Variables** — never commit `.env`. The app runs with the built-in Simulation Core if no keys are configured.

> **Vercel storage is ephemeral.** Vercel Functions can only write to `/tmp`, and each instance has its own copy. The app automatically uses `/tmp/jarvis` when `VERCEL` is set. Sessions, memories, artifacts and custom agents therefore reset on cold starts and are not shared between concurrent instances. For durable state, set `JARVIS_DATA_DIR` to a mounted persistent volume or run the app on a long-lived host. The function timeout is 60 seconds in `vercel.json`; raise it for longer provider runs if your plan allows.

> **Approval gates need one instance.** Approval and question answers are held in the in-memory run registry. If Vercel routes the follow-up request to a different function instance, the gate cannot be resolved and the run waits until its timeout. Use Vercel for the Simulation Core and approval-free demos; use a long-lived host (or add shared run state) for approval-sensitive work.

---

## Tools

| Tool | Category | Approval | What it does |
| --- | --- | --- | --- |
| `update_plan` | Cognition | No | Replace the visible task plan |
| `web_search` | Research | No | Query Tavily or public search fallbacks |
| `fetch_url` | Research | No | Read a public page with SSRF and size guards |
| `create_artifact` | Delivery | No | Save a markdown/code/JSON/HTML/text deliverable |
| `run_javascript` | Compute | **Yes** | Execute JavaScript in a Node `vm` sandbox |
| `calculator` | Compute | No | Safe arithmetic parser with math functions |
| `workspace_list` | Files | No | List the sandboxed workspace |
| `workspace_read` | Files | No | Read UTF-8 text from the workspace |
| `workspace_write` | Files | **Yes** | Write inside the sandboxed workspace |
| `save_memory` | Cognition | No | Persist an operator preference or fact |
| `search_memory` | Cognition | No | Retrieve relevant memory |
| `ask_user` | Human | No | Pause the run for a blocking question |
| `spawn_agent` | Orchestration | No | Delegate to a read-only specialist |
| `get_datetime` | System | No | Local/UTC time and timezone |

### Search without Tavily

If no Tavily key is configured, `web_search` queries several public sources in parallel: Google News RSS, Hacker News (Algolia), Wikipedia, Bing News RSS and Semantic Scholar. Results are deduplicated by normalized URL, source-ranked and capped to the requested count. This is free but depends on upstream availability; the UI reports an empty sweep honestly rather than inventing sources.

### Sandbox boundaries

- JavaScript runs in a fresh `node:vm` context with code generation and WASM disabled, a 5-second synchronous limit and an 8-second async limit. Node globals, filesystem, network and subprocess access are unavailable. `console.*` is captured.
- Workspace tools are constrained to `data/workspace`. Absolute paths and `..` escapes are rejected. Reads are limited to 60k characters; writes to 300k characters.
- `fetch_url` resolves DNS and blocks localhost, `.local`, `.internal`, cloud metadata hosts and private IP ranges. Redirects are re-validated. Responses are capped at 4 MB and only text/HTML/JSON/XML are accepted.
- Memory refuses values that look like API keys, private keys or bearer tokens.

### Subagent boundary

`spawn_agent` gives a specialist read-only research tools. Dangerous tools (`run_javascript`, `workspace_write`) and delegation are removed. A subagent cannot spawn another subagent. Its result is returned to the parent, which stays accountable for the final answer.

---

## Data & privacy

Everything is local by default.

```
data/
├── jarvis.json       # agents, sessions, messages, plans, memories, artifacts, settings
├── secrets.json      # provider keys, mode 0600 (only created when a key is saved)
└── workspace/        # sandboxed files used by workspace_* tools
```

- Atomic writes (`write temp → fsync → rename`) protect the JSON store.
- Data directory is configurable with `JARVIS_DATA_DIR`. On Vercel it defaults to `/tmp/jarvis`; that data is ephemeral and per-instance.
- `data/` and `.env` are gitignored.
- Sessions can be exported as Markdown from the channel header or `GET /api/sessions/:id/export`.
- **Settings → System → Delete all data** erases every channel, memory, artifact and custom agent, then clears `data/workspace`. Built-in intelligences, settings, provider keys and interface preferences are preserved. The server refuses the request while a run is streaming.
- There is no analytics, telemetry or cloud sync.
- When a real provider is used, prompts, tool results and conversation history are sent to that provider. Live search sends only the query. Local providers (Ollama/LM Studio) keep inference on the machine.

Use **Settings → System** for runtime facts and to manage stored state.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Command palette |
| `Ctrl/Cmd + B` | Toggle sidebar |
| `Ctrl/Cmd + J` | Toggle cognition panel (channel view) |
| `Ctrl/Cmd + Enter` | Launch mission from the Core |
| `Enter` | Send directive in a channel |
| `Shift + Enter` | Newline in the composer |
| `Escape` | Close the topmost surface (approvals/questions are protected) |

---

## Scripts

```bash
npm run dev        # API + Vite with hot reload
npm run dev:web    # Vite only
npm run dev:server # API only
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production client build
npm start          # production server (serves dist + API)
npm run smoke      # isolated end-to-end API smoke test
```

`npm run smoke` starts a throwaway server on a free port with a temporary data directory, exercises health, bootstrap, memory, planning, approval, code execution, artifacts, delegation, research fallback, settings, export, data reset and error handling, then removes the temporary data. It never touches your real `data/` directory. Research asserts are network-tolerant: an offline machine still passes if the retrieval layer fails gracefully.

---

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the runtime loop, event protocol, persistence model, component map and extension points.

At a glance:

```
React + Zustand (src)
        │  fetch / SSE
        ▼
Express API (server/index.ts)
        │
        ├── Store (JSON persistence + workspace)
        └── AgentRuntime
              ├── Provider adapter (demo / OpenAI-compatible / Anthropic)
              ├── Tool registry (14 tools)
              ├── Plan + memory + artifacts
              ├── Approval / question gates
              └── Read-only subagents
```

---

## Troubleshooting

**The UI says “Unable to reach the core server.”**
Start the API (`npm run dev:server`) and confirm `http://localhost:8787/api/health`. In dev, Vite proxies `/api` to port 8787.

**A provider says “key required” even though I saved one.**
Environment keys take priority; an empty env value is ignored. Use **Test connection** in settings and check the key state. For OpenAI-compatible providers, verify both the model ID and base URL.

**Search returns zero results.**
Public search endpoints rate-limit and occasionally block requests. Add a Tavily key for reliable retrieval, or retry a narrower query. The agent is instructed not to fabricate results.

**Approvals never appear.**
Check whether **YOLO mode** is enabled in Settings → Core Behavior. In YOLO mode gates are bypassed by design.

**Production build serves a blank page.**
Run `npm run build` first, then `npm start`, and open port 8787 (not 3000). The production server only serves `dist/` if it exists.

---

## Status & limits

- The simulation core is intentionally deterministic, not an LLM. It recognizes common mission intents, including a built-in Marvel trivia archive that answers without a network or key; connect a real model for open-ended reasoning.
- Search quality depends on public endpoints unless Tavily is configured.
- The JavaScript sandbox is a process-level `vm`, not a hardened container. It is a second line of defense behind explicit approval; do not execute untrusted code from adversarial sources.
- File attachments are not yet wired to the runtime; the composer exposes the intent and directs users to workspace tools.
- Voice depends on browser support (`SpeechRecognition` / `speechSynthesis`) and available system voices.
- Single-operator, single-process design. There is no auth layer or multi-tenant isolation; bind it to localhost or put it behind your own access control before exposing it to a network.

---

## Credits

Visual direction inspired by the [jarvis-ui](https://github.com/kariimmoalla1-source/jarvis-ui) reactor concept. Rebuilt React interface, agent runtime, tool layer, persistence, voice integration and visual system for this project.
