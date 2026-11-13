import type {
  AgentProfile,
  ArtifactMeta,
  ChatMessage,
  Memory,
  PlanTask,
  RunStatus,
  ToolCallRecord,
  Usage,
  UserQuestion,
  ApprovalRequest,
} from '../../shared/types';

export type View = 'core' | 'session';
export type CogTab = 'cognition' | 'memory' | 'artifacts' | 'system';

export interface SubagentTrace {
  id: string;
  phase: 'started' | 'finished';
  agentName: string;
  task: string;
  result?: string;
  at: number;
}

export interface RunNotice {
  id: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  at: number;
}

export interface LiveRun {
  runId: string;
  sessionId: string;
  agent: Pick<AgentProfile, 'id' | 'name' | 'callsign' | 'accent' | 'icon'> | null;
  simulated: boolean;
  model: string;
  startedAt: number;
  status: RunStatus;
  detail?: string;
  text: string;
  toolCalls: ToolCallRecord[];
  plan: PlanTask[];
  artifacts: ArtifactMeta[];
  memories: Memory[];
  subagents: SubagentTrace[];
  notices: RunNotice[];
  approval?: ApprovalRequest | null;
  question?: UserQuestion | null;
  usage: Usage;
  latencyMs?: number;
  error?: string;
  finalMessage?: ChatMessage;
}

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export interface AgentModalState {
  open: boolean;
  agentId?: string;
}

export interface UIState {
  sidebarOpen: boolean;
  cogOpen: boolean;
  cogTab: CogTab;
  settingsOpen: boolean;
  paletteOpen: boolean;
  agentModal: AgentModalState;
  artifactId: string | null;
  confirm: ConfirmState | null;
}

export type BootState = 'loading' | 'ready' | 'error';

export interface AppBootstrapState {
  agents: AgentProfile[];
  sessions: import('../../shared/types').SessionSummary[];
  settings: import('../../shared/types').PublicSettings;
  tools: import('../../shared/types').ToolInfo[];
  providerPresets: import('../../shared/types').ProviderPresetInfo[];
  stats: import('../../shared/types').Stats;
  server: {
    version: string;
    uptime: number;
    node: string;
    dataDir: string;
  };
}

export const STATUS_LABELS: Record<RunStatus, string> = {
  idle: 'Standby',
  listening: 'Listening',
  thinking: 'Thinking',
  acting: 'Acting',
  speaking: 'Speaking',
  awaiting_approval: 'Authorization required',
  awaiting_input: 'Input required',
  completed: 'Complete',
  failed: 'Interrupted',
  cancelled: 'Stopped',
  max_steps: 'Step limit',
};

export const STATUS_COLORS: Record<RunStatus, string> = {
  idle: 'var(--accent)',
  listening: '#63e7ff',
  thinking: '#ffc464',
  acting: 'var(--accent)',
  speaking: '#b18cff',
  awaiting_approval: '#ffb454',
  awaiting_input: '#ffb454',
  completed: 'var(--accent)',
  failed: '#ff5f7e',
  cancelled: '#8aa19a',
  max_steps: '#ffb454',
};
