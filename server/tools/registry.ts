import type {
  AgentEvent,
  AgentProfile,
  ArtifactMeta,
  Memory,
  PlanTask,
} from '../../shared/types';
import type { Store } from '../store';
import { withTimeout } from '../util';
import {
  askUserTool,
  createArtifactTool,
  getDatetimeTool,
  saveMemoryTool,
  searchMemoryTool,
  spawnAgentTool,
  updatePlanTool,
} from './cognition';
import { calculatorTool, javascriptTool } from './compute';
import { workspaceList, workspaceRead, workspaceWrite } from './files';
import { fetchUrl, webSearch } from './research';

export interface SubagentResult {
  agent: string;
  callsign: string;
  result: string;
  steps: number;
  artifacts?: string[];
  artifactMeta?: ArtifactMeta;
}

export interface ToolContext {
  store: Store;
  sessionId: string;
  runId: string;
  agent: AgentProfile;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
  setPlan: (tasks: PlanTask[]) => void;
  askUser: (question: string, options?: string[]) => Promise<string>;
  spawnAgent: (agentRef: string, task: string, maxSteps: number) => Promise<SubagentResult>;
  depth: number;
}

export interface ToolResult {
  content: string;
  summary?: string;
  artifact?: ArtifactMeta;
  memory?: Memory;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  approvalReason?: (args: Record<string, unknown>) => string;
  timeoutMs?: number;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

const OBJ = (properties: Record<string, unknown>, required: string[] = [], description?: string) => ({
  type: 'object',
  description,
  properties,
  required,
  additionalProperties: false,
});

const STR = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'string',
  description,
  ...extra,
});

const NUM = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'number',
  description,
  ...extra,
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'update_plan',
    category: 'Cognition',
    description:
      'Create or replace the visible task plan for this run. Call this at the start of any multi-step mission, then call it again whenever a task changes state. The operator sees the plan live. Replaces the whole plan each call, so include every task and its current status. Keep plans to 3–8 concrete tasks; mark exactly one task in_progress while working.',
    parameters: OBJ(
      {
        tasks: {
          type: 'array',
          description: 'Full ordered task list.',
          minItems: 1,
          maxItems: 12,
          items: OBJ(
            {
              title: STR('Short, concrete task title (max 180 chars).'),
              status: STR('Task state.', {
                enum: ['pending', 'in_progress', 'done', 'failed', 'skipped'],
              }),
              note: STR('Optional short note, blocker or result.'),
            },
            ['title', 'status'],
          ),
        },
      },
      ['tasks'],
    ),
    requiresApproval: false,
    execute: updatePlanTool,
  },
  {
    name: 'web_search',
    category: 'Research',
    description:
      'Search the live public web and return titles, URLs, snippets and source names. Use this before making claims about current events, products, people or anything outside stable background knowledge. Then use fetch_url on the most authoritative result when you need detail. Never invent URLs or results that were not returned.',
    parameters: OBJ(
      {
        query: STR('Specific search query. Include entities, dates or constraints for precision.'),
        max_results: NUM('Number of results to return (1–10, default 6).', {
          minimum: 1,
          maximum: 10,
        }),
      },
      ['query'],
    ),
    requiresApproval: false,
    timeoutMs: 30_000,
    execute: async (args, ctx) => webSearch(args, ctx),
  },
  {
    name: 'fetch_url',
    category: 'Research',
    description:
      'Read the main text of a public http(s) page, JSON or XML document. Use after web_search to read a source in depth. Private, local and internal addresses are blocked. Returns title, URL, content and truncation status. Do not fetch the same URL repeatedly.',
    parameters: OBJ(
      {
        url: STR('Full public http(s) URL.'),
        max_chars: NUM('Maximum characters of extracted text (500–20000, default 7000).', {
          minimum: 500,
          maximum: 20000,
        }),
      },
      ['url'],
    ),
    requiresApproval: false,
    timeoutMs: 30_000,
    execute: async (args, ctx) => fetchUrl(args, ctx),
  },
  {
    name: 'create_artifact',
    category: 'Delivery',
    description:
      'Save a substantial deliverable as a downloadable artifact shown in the operator UI. Use for reports, briefs, plans, long-form writing, code files, JSON data or HTML. Do not use for short chat answers. After creating one, summarise it in chat and point the operator to the Artifacts panel; do not paste the full content into the conversation.',
    parameters: OBJ(
      {
        title: STR('Clear artifact title (max 120 chars).'),
        type: STR('Artifact format.', {
          enum: ['markdown', 'html', 'code', 'json', 'text'],
        }),
        language: STR('Programming language for code artifacts, e.g. javascript, typescript, python.'),
        content: STR('Complete artifact content. Markdown is preferred for documents.'),
      },
      ['title', 'type', 'content'],
    ),
    requiresApproval: false,
    execute: createArtifactTool,
  },
  {
    name: 'run_javascript',
    category: 'Compute',
    description:
      'Execute JavaScript in an isolated local VM for calculations, data transforms and algorithm verification. Node globals, filesystem, network and subprocesses are unavailable. Output is captured via console.log and the final resolved value. Execution pauses for operator approval. Never include secrets in code.',
    parameters: OBJ(
      {
        code: STR('JavaScript code. Top-level await is supported. console.log captures output.'),
        purpose: STR('One-line description of what this verifies or computes.'),
      },
      ['code'],
    ),
    requiresApproval: true,
    approvalReason: () => 'Executes arbitrary JavaScript in the local sandbox. Review the code before authorizing.',
    timeoutMs: 20_000,
    execute: javascriptTool,
  },
  {
    name: 'calculator',
    category: 'Compute',
    description:
      'Evaluate a mathematical expression safely and precisely. Supports + - * / % ^, parentheses and functions sqrt, abs, sin, cos, tan, log, ln, exp, round, floor, ceil, min, max, pow. Use instead of mental arithmetic when precision matters.',
    parameters: OBJ(
      {
        expression: STR('Arithmetic expression, e.g. "sqrt(2) * 10^3" or "min(4, 9) + 12/3".'),
      },
      ['expression'],
    ),
    requiresApproval: false,
    execute: async (args) => calculatorTool(args),
  },
  {
    name: 'workspace_list',
    category: 'Files',
    description:
      'List files and directories inside the sandboxed operator workspace (data/workspace). Use before reading or writing when the project structure is unknown. Paths are relative to the workspace root.',
    parameters: OBJ(
      {
        path: STR('Relative directory path. Defaults to the workspace root.'),
        depth: NUM('Recursion depth (0–4, default 2).', { minimum: 0, maximum: 4 }),
      },
      [],
    ),
    requiresApproval: false,
    execute: async (args) => workspaceList(args),
  },
  {
    name: 'workspace_read',
    category: 'Files',
    description:
      'Read a UTF-8 text file from the sandboxed workspace. Paths are relative to the workspace root. Binary files are rejected. Use workspace_list first if you do not know the exact path.',
    parameters: OBJ({ path: STR('Relative file path.') }, ['path']),
    requiresApproval: false,
    execute: async (args) => workspaceRead(args),
  },
  {
    name: 'workspace_write',
    category: 'Files',
    description:
      'Create or overwrite a UTF-8 text file inside the sandboxed workspace. Parent directories are created automatically. Maximum 300,000 characters. Writing requires operator approval. Prefer artifacts for deliverables the operator needs to read; use workspace files for project structure and code that must persist.',
    parameters: OBJ(
      {
        path: STR('Relative file path inside the workspace.'),
        content: STR('Full text content.'),
        append: { type: 'boolean', description: 'Append instead of overwriting (default false).' },
      },
      ['path', 'content'],
    ),
    requiresApproval: true,
    approvalReason: (args) =>
      `Writes ${String(args.path ?? 'a file')} inside the local sandboxed workspace${args.append ? ' (append)' : ''}.`,
    execute: async (args) => workspaceWrite(args),
  },
  {
    name: 'save_memory',
    category: 'Cognition',
    description:
      'Store a durable fact, preference or decision in long-term memory. Use only for information that should persist across sessions: operator preferences, project constraints, agreed decisions. Never store secrets, credentials, ephemeral details or raw search results. Deduplicates near-identical content.',
    parameters: OBJ(
      {
        content: STR('Atomic fact in clear third-person or imperative form, max 1,500 chars.'),
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short retrieval tags, e.g. ["preference", "design"].',
          maxItems: 8,
        },
        importance: NUM('Durability/importance from 1 (minor) to 5 (critical).', {
          minimum: 1,
          maximum: 5,
        }),
      },
      ['content'],
    ),
    requiresApproval: false,
    execute: saveMemoryTool,
  },
  {
    name: 'search_memory',
    category: 'Cognition',
    description:
      'Search durable operator memory for relevant preferences, project facts and prior decisions. Do this before re-asking the operator for information they may already have provided.',
    parameters: OBJ(
      {
        query: STR('Keywords or a short description of what you need to recall.'),
      },
      ['query'],
    ),
    requiresApproval: false,
    execute: searchMemoryTool,
  },
  {
    name: 'ask_user',
    category: 'Human',
    description:
      'Pause the run and ask the operator a direct question. Use sparingly, for high-impact ambiguity, destructive choices, missing credentials or irreversible actions. The run blocks until they answer. Include options when the decision is a small set of choices.',
    parameters: OBJ(
      {
        question: STR('Clear, specific question (max 800 chars).'),
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional short suggested answers (max 6).',
          maxItems: 6,
        },
      },
      ['question'],
    ),
    requiresApproval: false,
    execute: askUserTool,
  },
  {
    name: 'spawn_agent',
    category: 'Orchestration',
    description:
      'Delegate a scoped sub-task to a specialist agent (oracle = research, forge = engineering, scribe = writing, sentinel = risk/security). The specialist runs independently with read-only tools, returns a textual brief, and cannot spawn further agents. Use for parallel deep work, then integrate the result yourself.',
    parameters: OBJ(
      {
        agent: STR('Specialist id or callsign: oracle, forge, scribe, sentinel.', {
          enum: ['oracle', 'forge', 'scribe', 'sentinel'],
        }),
        task: STR('Complete, self-contained task brief. Include constraints and desired output.'),
        max_steps: NUM('Maximum specialist steps (1–6, default 4).', {
          minimum: 1,
          maximum: 6,
        }),
      },
      ['agent', 'task'],
    ),
    requiresApproval: false,
    timeoutMs: 150_000,
    execute: spawnAgentTool,
  },
  {
    name: 'get_datetime',
    category: 'System',
    description:
      'Get the current local date, time, timezone, ISO timestamp and Unix time. Use for any date-sensitive reasoning or when the operator asks about time.',
    parameters: OBJ({}, []),
    requiresApproval: false,
    execute: async () => getDatetimeTool(),
  },
];

const BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function toolsForAgent(agent: AgentProfile): ToolDefinition[] {
  if (agent.tools.includes('*')) return TOOL_DEFINITIONS;
  const allowed = new Set(agent.tools);
  return TOOL_DEFINITIONS.filter((tool) => allowed.has(tool.name));
}

export function safeToolsForAgent(agent: AgentProfile): ToolDefinition[] {
  const dangerous = new Set(['run_javascript', 'workspace_write', 'spawn_agent']);
  return toolsForAgent(agent).filter((tool) => !dangerous.has(tool.name));
}

export function toolInfos() {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description.split('.')[0] + '.',
    category: tool.category,
    requiresApproval: tool.requiresApproval,
  }));
}

export async function executeTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.signal.aborted) {
    throw new Error('Run cancelled before tool execution.');
  }
  return withTimeout(
    tool.execute(args, ctx),
    tool.timeoutMs ?? 60_000,
    `${tool.name} timed out.`,
  );
}
