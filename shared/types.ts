/* ────────────────────────────────────────────────────────────────
   J.A.R.V.I.S. CORE — shared contracts (server ⇄ client)
   ──────────────────────────────────────────────────────────────── */

export type ProviderId =
  | 'demo'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'groq'
  | 'deepseek'
  | 'google'
  | 'mistral'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export type AccentId = 'teal' | 'cyan' | 'amber' | 'violet' | 'rose';

export type AgentIcon =
  | 'core'
  | 'oracle'
  | 'forge'
  | 'scribe'
  | 'sentinel'
  | 'ultron'
  | 'nexus'
  | 'custom';

export type RunStatus =
  | 'idle'
  | 'thinking'
  | 'acting'
  | 'listening'
  | 'speaking'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'max_steps';

export type ToolStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'success'
  | 'error'
  | 'denied'
  | 'cancelled';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface PlanTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  note?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  callsign: string;
  description: string;
  systemPrompt: string;
  accent: AccentId;
  icon: AgentIcon;
  tools: string[];
  builtin: boolean;
  createdAt: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  category?: string;
  args?: unknown;
  status: ToolStatus;
  summary?: string;
  resultPreview?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  requiresApproval?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  agentId?: string;
  agentName?: string;
  agentCallsign?: string;
  runId?: string;
  toolCalls?: ToolCallRecord[];
  artifacts?: string[];
  usage?: Usage;
  error?: string;
  latencyMs?: number;
  simulated?: boolean;
}

export interface Session {
  id: string;
  title: string;
  agentId: string;
  messages: ChatMessage[];
  plan: PlanTask[];
  artifacts: string[];
  usage: Usage;
  runCount: number;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  agentId: string;
  messageCount: number;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  preview?: string;
}

export interface ArtifactMeta {
  id: string;
  sessionId: string;
  runId?: string;
  title: string;
  type: 'markdown' | 'html' | 'code' | 'json' | 'text';
  language?: string;
  createdAt: number;
  size: number;
}

export interface Artifact extends ArtifactMeta {
  content: string;
}

export interface Memory {
  id: string;
  content: string;
  tags: string[];
  importance: number;
  sourceSessionId?: string;
  sourceAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ModelSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
}

export interface ToolSettings {
  tavilyKeySet?: boolean;
}

export interface AppSettings {
  model: ModelSettings;
  maxSteps: number;
  autoMemory: boolean;
  yoloMode: boolean;
  approvalTimeoutMs: number;
  systemPromptExtra: string;
  tools: ToolSettings;
}

export type KeyState = 'env' | 'saved' | 'missing' | 'not_required';

export interface ProviderStatus {
  configured: boolean;
  demo: boolean;
  keyState: KeyState;
  label: string;
  hint?: string;
}

export interface PublicSettings extends AppSettings {
  providerStatus: ProviderStatus;
  keyStates: Record<string, KeyState>;
  tavilyConfigured: boolean;
  dataDir: string;
  version: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
  requiresApproval: boolean;
}

export interface ProviderPresetInfo {
  id: ProviderId;
  label: string;
  baseUrl: string;
  model: string;
  keyRequired: boolean;
  local: boolean;
  hint: string;
}

export interface Stats {
  sessions: number;
  runs: number;
  memories: number;
  artifacts: number;
  inputTokens: number;
  outputTokens: number;
  tools: number;
}

export interface Bootstrap {
  agents: AgentProfile[];
  sessions: SessionSummary[];
  settings: PublicSettings;
  tools: ToolInfo[];
  providerPresets: ProviderPresetInfo[];
  stats: Stats;
  server: {
    version: string;
    uptime: number;
    node: string;
    dataDir: string;
  };
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  toolName: string;
  category: string;
  args: unknown;
  reason: string;
  expiresAt: number;
}

export interface UserQuestion {
  id: string;
  runId: string;
  question: string;
  options?: string[];
  expiresAt: number;
}

export interface ArtifactEvent extends ArtifactMeta {}

export interface RunStartedEvent {
  type: 'run_started';
  runId: string;
  sessionId: string;
  agent: Pick<AgentProfile, 'id' | 'name' | 'callsign' | 'accent' | 'icon'>;
  userMessage: ChatMessage;
  simulated: boolean;
  model: string;
  startedAt: number;
}

export type AgentEvent =
  | RunStartedEvent
  | { type: 'status'; status: RunStatus; detail?: string }
  | { type: 'assistant_delta'; messageId: string; delta: string }
  | { type: 'tool_call'; call: ToolCallRecord }
  | {
      type: 'tool_update';
      callId: string;
      status: ToolStatus;
      summary?: string;
      resultPreview?: string;
      error?: string;
      durationMs?: number;
      finishedAt?: number;
    }
  | { type: 'plan'; tasks: PlanTask[] }
  | { type: 'approval'; approval: ApprovalRequest }
  | { type: 'approval_resolved'; approvalId: string; approved: boolean }
  | { type: 'question'; question: UserQuestion }
  | { type: 'question_resolved'; questionId: string }
  | { type: 'artifact'; artifact: ArtifactEvent }
  | { type: 'memory'; memory: Memory }
  | { type: 'subagent'; phase: 'started' | 'finished'; agentName: string; task: string; result?: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
  | {
      type: 'run_end';
      runId: string;
      status: 'completed' | 'failed' | 'cancelled' | 'max_steps';
      message?: ChatMessage;
      error?: string;
      usage?: Usage;
      latencyMs?: number;
    };

export interface ApiError {
  error: string;
  detail?: string;
}

export const DENIED_RESULT = 'ACTION DENIED — the operator declined this tool execution. Do not retry without asking the user.';
export const CANCELLED_RESULT = 'ACTION CANCELLED — the run was aborted by the operator.';
