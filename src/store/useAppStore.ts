import { create } from 'zustand';
import type {
  AgentEvent,
  AgentProfile,
  ApprovalRequest,
  ArtifactMeta,
  ChatMessage,
  Memory,
  PlanTask,
  ProviderPresetInfo,
  Session,
  SessionSummary,
  ToolCallRecord,
  ToolInfo,
  UserQuestion,
} from '../../shared/types';
import { api, ApiError, streamRun } from '../lib/api';
import { sfx } from '../lib/sfx';
import type {
  AppBootstrapState,
  BootState,
  CogTab,
  ConfirmState,
  LiveRun,
  RunNotice,
  Toast,
  UIState,
  View,
} from '../lib/types';
import { agentFor, uid } from '../lib/utils';

let activeController: AbortController | null = null;

function titleFromInput(input: string): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  if (clean.length <= 58) return clean.charAt(0).toUpperCase() + clean.slice(1);
  const cut = clean.slice(0, 57);
  return `${cut.slice(0, cut.lastIndexOf(' ')) || cut}…`;
}

function summary(session: Session): SessionSummary {
  const last = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    title: session.title,
    agentId: session.agentId,
    messageCount: session.messages.length,
    pinned: session.pinned,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    preview: last?.content.slice(0, 110),
  };
}

function recordFromEvent(record: ToolCallRecord, existing: ToolCallRecord[]): ToolCallRecord[] {
  const index = existing.findIndex((item) => item.id === record.id);
  if (index === -1) return [...existing, record];
  const next = [...existing];
  next[index] = { ...next[index], ...record };
  return next;
}

interface AppStore extends AppBootstrapState {
  bootState: BootState;
  bootError: string | null;
  initialized: boolean;

  activeSessionId: string | null;
  session: Session | null;
  sessionLoading: boolean;
  activeAgentId: string;
  view: View;

  run: LiveRun | null;
  artifacts: ArtifactMeta[];
  memories: Memory[];

  toasts: Toast[];
  ui: UIState;

  init: () => Promise<void>;
  retryInit: () => Promise<void>;

  setView: (view: View) => void;
  setActiveAgentId: (id: string) => void;
  openSession: (id: string) => Promise<void>;
  newSession: (agentId?: string) => Promise<void>;
  launchMission: (prompt: string, agentId?: string) => Promise<void>;
  sendMessage: (input: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  approveAction: (approved: boolean) => Promise<void>;
  answerQuestion: (answer: string) => Promise<void>;
  handleRunEvent: (event: AgentEvent) => void;
  finishRun: (event: Extract<AgentEvent, { type: 'run_end' }>) => Promise<void>;
  recoverRun: () => Promise<void>;

  renameSession: (id: string, title: string) => Promise<void>;
  togglePinSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  exportSession: () => void;

  saveSettings: (patch: Record<string, unknown>) => Promise<boolean>;
  resetAllData: () => Promise<boolean>;
  saveProviderKey: (provider: string, key: string | null) => Promise<boolean>;
  saveTavilyKey: (key: string | null) => Promise<boolean>;
  saveAgent: (id: string | undefined, patch: Partial<AgentProfile>) => Promise<boolean>;
  deleteAgent: (id: string) => Promise<void>;

  addMemory: (content: string, tags?: string[], importance?: number) => Promise<boolean>;
  deleteMemory: (id: string) => Promise<void>;
  loadArtifacts: () => Promise<void>;
  deleteArtifact: (id: string) => Promise<void>;

  addToast: (type: Toast['type'], message: string) => void;
  dismissToast: (id: string) => void;

  setUI: (patch: Partial<UIState>) => void;
  toggleSidebar: () => void;
  setCogOpen: (open: boolean) => void;
  setCogTab: (tab: CogTab) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openPalette: () => void;
  closePalette: () => void;
  openAgentModal: (agentId?: string) => void;
  closeAgentModal: () => void;
  openArtifact: (id: string) => void;
  closeArtifact: () => void;
  askConfirm: (state: ConfirmState) => void;
  closeConfirm: () => void;
}

const initialUI: UIState = {
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 1180 : true,
  cogOpen: typeof window !== 'undefined' ? window.innerWidth >= 1280 : false,
  cogTab: 'cognition',
  settingsOpen: false,
  paletteOpen: false,
  agentModal: { open: false },
  artifactId: null,
  confirm: null,
};

function emptyBootstrap(): AppBootstrapState {
  return {
    agents: [],
    sessions: [],
    settings: {
      model: {
        provider: 'demo',
        model: 'jarvis-sim-1',
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
      providerStatus: {
        configured: true,
        demo: true,
        keyState: 'not_required',
        label: 'Simulation Core',
      },
      keyStates: {},
      tavilyConfigured: false,
      dataDir: '',
      version: '',
    },
    tools: [],
    providerPresets: [],
    stats: {
      sessions: 0,
      runs: 0,
      memories: 0,
      artifacts: 0,
      inputTokens: 0,
      outputTokens: 0,
      tools: 0,
    },
    server: { version: '', uptime: 0, node: '', dataDir: '' },
  };
}

export const useAppStore = create<AppStore>()((set, get) => ({
  ...emptyBootstrap(),
  bootState: 'loading',
  bootError: null,
  initialized: false,
  activeSessionId: null,
  session: null,
  sessionLoading: false,
  activeAgentId: 'core',
  view: 'core',
  run: null,
  artifacts: [],
  memories: [],
  toasts: [],
  ui: initialUI,

  init: async () => {
    set({ bootState: 'loading', bootError: null });
    try {
      const [bootstrap, memoriesResponse, artifactsResponse] = await Promise.all([
        api.bootstrap(),
        api.listMemories(),
        api.listArtifacts(),
      ]);

      let session: Session | null = null;
      let activeSessionId: string | null = null;
      let view: View = 'core';
      let activeAgentId = 'core';

      const remembered =
        typeof window !== 'undefined' ? localStorage.getItem('jarvis.session') : null;
      if (remembered && bootstrap.sessions.some((item) => item.id === remembered)) {
        try {
          const detail = await api.getSession(remembered);
          session = detail.session;
          activeSessionId = detail.session.id;
          activeAgentId = detail.session.agentId;
          view = 'session';
        } catch {
          localStorage.removeItem('jarvis.session');
        }
      }

      set({
        ...bootstrap,
        memories: memoriesResponse.memories,
        artifacts: artifactsResponse.artifacts,
        activeSessionId,
        session,
        activeAgentId,
        view,
        bootState: 'ready',
        initialized: true,
        ui: {
          ...get().ui,
          sidebarOpen: window.innerWidth >= 1180,
          cogOpen: view === 'session' && window.innerWidth >= 1280,
        },
      });
      if (session) {
        set({ sessionLoading: false });
      }
    } catch (error) {
      set({
        bootState: 'error',
        bootError:
          error instanceof Error
            ? error.message
            : 'The core server did not respond. Is it running?',
      });
    }
  },

  retryInit: async () => {
    await get().init();
  },

  setView: (view) => {
    if (view === 'core' && get().run) {
      get().addToast('warn', 'Stop the active run before leaving the channel.');
      return;
    }
    set({ view });
    if (view === 'core') get().setUI({ cogOpen: false });
  },

  setActiveAgentId: (id) => set({ activeAgentId: id }),

  openSession: async (id) => {
    if (get().run) {
      get().addToast('warn', 'A run is active. Stop it before switching channels.');
      return;
    }
    if (id === get().activeSessionId && get().session) {
      set({ view: 'session' });
      if (window.innerWidth < 1280) set({ ui: { ...get().ui, cogOpen: false } });
      return;
    }
    set({ sessionLoading: true, view: 'session', activeSessionId: id });
    try {
      const [detail, artifacts] = await Promise.all([
        api.getSession(id),
        api.listArtifacts(),
      ]);
      set({
        session: detail.session,
        sessionLoading: false,
        activeSessionId: detail.session.id,
        activeAgentId: detail.session.agentId,
        artifacts: artifacts.artifacts,
      });
      localStorage.setItem('jarvis.session', detail.session.id);
      if (window.innerWidth < 1100) {
        set({ ui: { ...get().ui, sidebarOpen: false } });
      }
    } catch (error) {
      set({ sessionLoading: false, view: 'core', activeSessionId: null, session: null });
      get().addToast('error', error instanceof Error ? error.message : 'Failed to open session.');
    }
  },

  newSession: async (agentId) => {
    if (get().run) {
      get().addToast('warn', 'A run is active. Stop it before starting a new channel.');
      return;
    }
    try {
      const chosen = agentId || get().activeAgentId;
      const { session } = await api.createSession({ agentId: chosen });
      set((state) => ({
        session,
        activeSessionId: session.id,
        activeAgentId: session.agentId,
        view: 'session',
        sessionLoading: false,
        sessions: [summary(session), ...state.sessions],
        ui: { ...state.ui, sidebarOpen: window.innerWidth >= 1100 ? state.ui.sidebarOpen : false },
      }));
      localStorage.setItem('jarvis.session', session.id);
      sfx.click();
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Could not create a session.');
    }
  },

  launchMission: async (prompt, agentId) => {
    if (get().run) {
      get().addToast('warn', 'A run is active. Stop it before launching another mission.');
      return;
    }
    await get().newSession(agentId ?? get().activeAgentId);
    if (get().session) {
      await get().sendMessage(prompt);
    }
  },

  sendMessage: async (input) => {
    const content = input.trim();
    if (!content) return;
    if (get().run) {
      get().addToast('warn', 'The core is already processing a run.');
      return;
    }
    let session = get().session;
    if (!session) {
      await get().newSession(get().activeAgentId);
      session = get().session;
      if (!session) return;
    }

    const agent = agentFor(get().agents, session.agentId);
    const optimisticId = uid('temp');
    const optimistic: ChatMessage = {
      id: optimisticId,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    const initialRun: LiveRun = {
      runId: '',
      sessionId: session.id,
      agent: agent
        ? {
            id: agent.id,
            name: agent.name,
            callsign: agent.callsign,
            accent: agent.accent,
            icon: agent.icon,
          }
        : null,
      simulated: get().settings.model.provider === 'demo',
      model: get().settings.model.model,
      startedAt: Date.now(),
      status: 'thinking',
      detail: 'Establishing secure link',
      text: '',
      toolCalls: [],
      plan: [],
      artifacts: [],
      memories: [],
      subagents: [],
      notices: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    set((state) => ({
      session: state.session
        ? {
            ...state.session,
            title: state.session.title === 'New session' ? titleFromInput(content) : state.session.title,
            messages: [...state.session.messages, optimistic],
          }
        : state.session,
      run: initialRun,
      view: 'session',
      ui: { ...state.ui, sidebarOpen: window.innerWidth >= 1100 ? state.ui.sidebarOpen : false },
    }));
    sfx.send();

    const controller = new AbortController();
    activeController = controller;
    let ended = false;
    let finalization: Promise<void> | null = null;

    try {
      await streamRun(
        session.id,
        content,
        (event) => {
          if (event.type === 'run_end') {
            ended = true;
            finalization = get().finishRun(event);
            return;
          }
          get().handleRunEvent(event);
        },
        controller.signal,
      );
      if (!ended) {
        get().addToast('warn', 'The stream closed before the run reported completion.');
        await get().recoverRun();
      }
      if (finalization) await finalization;
    } catch (error) {
      if (controller.signal.aborted) {
        if (finalization) await finalization;
        else await get().recoverRun();
      } else {
        const message = error instanceof Error ? error.message : 'The run failed to start.';
        get().addToast('error', message);
        sfx.error();
        const run = get().run;
        if (run?.runId) {
          try {
            await api.cancelRun(run.runId);
          } catch {
            /* noop */
          }
        }
        if (finalization) await finalization;
        else await get().recoverRun();
      }
    } finally {
      if (activeController === controller) activeController = null;
    }
  },

  handleRunEvent: (event) => {
    const state = get();
    const run = state.run;
    if (!run) return;
    switch (event.type) {
      case 'run_started': {
        set((current) => ({
          run: current.run
            ? {
                ...current.run,
                runId: event.runId,
                agent: event.agent,
                simulated: event.simulated,
                model: event.model,
                startedAt: event.startedAt,
                status: 'thinking',
                detail: 'Mission accepted',
              }
            : current.run,
          session: current.session
            ? {
                ...current.session,
                messages: [
                  ...current.session.messages.filter(
                    (message) => !message.id.startsWith('temp-'),
                  ),
                  event.userMessage,
                ],
              }
            : current.session,
        }));
        break;
      }
      case 'status': {
        set((current) => ({
          run: current.run
            ? {
                ...current.run,
                status: event.status,
                detail: event.detail ?? current.run.detail,
              }
            : null,
        }));
        if (event.status === 'acting') sfx.tool();
        break;
      }
      case 'assistant_delta': {
        set((current) => ({
          run: current.run
            ? { ...current.run, text: current.run.text + event.delta }
            : null,
        }));
        break;
      }
      case 'tool_call': {
        sfx.tool();
        set((current) => ({
          run: current.run
            ? { ...current.run, toolCalls: recordFromEvent(event.call, current.run.toolCalls) }
            : null,
        }));
        break;
      }
      case 'tool_update': {
        set((current) => ({
          run: current.run
            ? {
                ...current.run,
                toolCalls: current.run.toolCalls.map((call) =>
                  call.id === event.callId
                    ? {
                        ...call,
                        status: event.status,
                        summary: event.summary ?? call.summary,
                        resultPreview: event.resultPreview ?? call.resultPreview,
                        error: event.error ?? call.error,
                        durationMs: event.durationMs ?? call.durationMs,
                        finishedAt: event.finishedAt,
                      }
                    : call,
                ),
              }
            : null,
        }));
        if (event.status === 'success') sfx.receive();
        break;
      }
      case 'plan': {
        set((current) => ({
          run: current.run ? { ...current.run, plan: event.tasks } : null,
          session: current.session ? { ...current.session, plan: event.tasks } : current.session,
        }));
        break;
      }
      case 'approval': {
        sfx.approval();
        set((current) => ({
          run: current.run
            ? { ...current.run, approval: event.approval, status: 'awaiting_approval' }
            : null,
        }));
        break;
      }
      case 'approval_resolved': {
        set((current) => ({
          run: current.run?.approval?.id === event.approvalId
            ? {
                ...current.run,
                approval: null,
                status: event.approved ? 'acting' : 'thinking',
                detail: event.approved ? 'Authorization granted' : 'Action denied',
              }
            : current.run,
        }));
        break;
      }
      case 'question': {
        sfx.approval();
        set((current) => ({
          run: current.run
            ? { ...current.run, question: event.question, status: 'awaiting_input' }
            : null,
        }));
        break;
      }
      case 'question_resolved': {
        set((current) => ({
          run: current.run?.question?.id === event.questionId
            ? { ...current.run, question: null, status: 'thinking' }
            : current.run,
        }));
        break;
      }
      case 'artifact': {
        set((current) => {
          const exists = current.artifacts.some((artifact) => artifact.id === event.artifact.id);
          return {
            run: current.run
              ? { ...current.run, artifacts: [...current.run.artifacts, event.artifact] }
              : null,
            artifacts: exists ? current.artifacts : [event.artifact, ...current.artifacts],
            session: current.session
              ? {
                  ...current.session,
                  artifacts: current.session.artifacts.includes(event.artifact.id)
                    ? current.session.artifacts
                    : [...current.session.artifacts, event.artifact.id],
                }
              : current.session,
          };
        });
        break;
      }
      case 'memory': {
        set((current) => ({
          run: current.run
            ? { ...current.run, memories: [...current.run.memories, event.memory] }
            : null,
          memories: [event.memory, ...current.memories.filter((m) => m.id !== event.memory.id)],
        }));
        break;
      }
      case 'subagent': {
        set((current) => ({
          run: current.run
            ? {
                ...current.run,
                subagents: [
                  ...current.run.subagents,
                  {
                    id: uid('sub'),
                    phase: event.phase,
                    agentName: event.agentName,
                    task: event.task,
                    result: event.result,
                    at: Date.now(),
                  },
                ],
              }
            : null,
        }));
        break;
      }
      case 'notice': {
        const notice: RunNotice = {
          id: uid('notice'),
          level: event.level,
          text: event.text,
          at: Date.now(),
        };
        set((current) => ({
          run: current.run
            ? { ...current.run, notices: [...current.run.notices, notice] }
            : null,
        }));
        if (event.level !== 'info') {
          get().addToast(event.level === 'error' ? 'error' : 'warn', event.text);
        }
        break;
      }
      default:
        break;
    }
  },

  finishRun: async (event) => {
    set((current) => ({
      run: current.run
        ? {
            ...current.run,
            runId: event.runId,
            usage: event.usage ?? current.run.usage,
            latencyMs: event.latencyMs ?? current.run.latencyMs,
            error: event.error,
            status:
              event.status === 'completed'
                ? 'completed'
                : event.status === 'cancelled'
                  ? 'cancelled'
                  : event.status === 'max_steps'
                    ? 'max_steps'
                    : 'failed',
            detail: event.error,
          }
        : null,
    }));

    if (event.status === 'completed') sfx.success();
    else if (event.status === 'failed') sfx.error();

    const sessionId = get().activeSessionId;
    if (!sessionId) {
      set({ run: null });
      return;
    }
    try {
      const [bootstrap, detail, artifacts, memories] = await Promise.all([
        api.bootstrap(),
        api.getSession(sessionId),
        api.listArtifacts(),
        api.listMemories(),
      ]);
      set((current) => ({
        agents: bootstrap.agents,
        sessions: bootstrap.sessions,
        settings: bootstrap.settings,
        tools: bootstrap.tools,
        providerPresets: bootstrap.providerPresets,
        stats: bootstrap.stats,
        server: bootstrap.server,
        session: current.activeSessionId === sessionId ? detail.session : current.session,
        artifacts: artifacts.artifacts,
        memories: memories.memories,
        run: null,
        ui: {
          ...current.ui,
          cogTab: event.status === 'completed' ? current.ui.cogTab : current.ui.cogTab,
        },
      }));
    } catch {
      set((current) => {
        let updated = current.session;
        if (updated && event.message) {
          updated = {
            ...updated,
            messages: [...updated.messages, event.message],
          };
        }
        return { session: updated, run: null };
      });
      get().addToast('warn', 'Run finished, but the channel could not be fully refreshed.');
    }
  },

  recoverRun: async () => {
    const sessionId = get().activeSessionId;
    set({ run: null });
    if (!sessionId) return;
    try {
      const [detail, artifacts, memories, sessions] = await Promise.all([
        api.getSession(sessionId),
        api.listArtifacts(),
        api.listMemories(),
        api.listSessions(),
      ]);
      set({
        session: detail.session,
        artifacts: artifacts.artifacts,
        memories: memories.memories,
        sessions: sessions.sessions,
      });
    } catch {
      /* noop */
    }
  },

  cancelRun: async () => {
    const run = get().run;
    if (!run) return;
    set((current) => ({
      run: current.run
        ? { ...current.run, status: 'cancelled', detail: 'Stop signal sent' }
        : null,
    }));
    if (!run.runId) {
      activeController?.abort();
      await get().recoverRun();
      return;
    }
    try {
      await api.cancelRun(run.runId);
      get().addToast('info', 'Stop signal sent. The core is closing the run.');
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Could not cancel the run.');
      activeController?.abort();
      await get().recoverRun();
    }
  },

  approveAction: async (approved) => {
    const run = get().run;
    if (!run?.approval) return;
    const approval: ApprovalRequest = run.approval;
    await api.resolveApproval(run.runId, approval.id, approved);
    if (approved) sfx.success();
    set((current) => ({
      run: current.run
        ? {
            ...current.run,
            status: approved ? 'acting' : 'thinking',
            detail: approved ? 'Authorizing action' : 'Action denied',
          }
        : null,
    }));
  },

  answerQuestion: async (answer) => {
    const run = get().run;
    if (!run?.question) return;
    const question: UserQuestion = run.question;
    await api.answerQuestion(run.runId, question.id, answer);
    set((current) => ({
      run: current.run
        ? { ...current.run, question: null, status: 'thinking', detail: 'Operator input received' }
        : null,
    }));
  },

  renameSession: async (id, title) => {
    const clean = title.trim();
    if (!clean) return;
    set((state) => ({
      sessions: state.sessions.map((item) => (item.id === id ? { ...item, title: clean } : item)),
      session:
        state.session?.id === id ? { ...state.session, title: clean } : state.session,
    }));
    try {
      await api.patchSession(id, { title: clean });
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Rename failed.');
      get().recoverRun();
    }
  },

  togglePinSession: async (id) => {
    const session = get().sessions.find((item) => item.id === id);
    if (!session) return;
    const pinned = !session.pinned;
    set((state) => ({
      sessions: state.sessions
        .map((item) => (item.id === id ? { ...item, pinned } : item))
        .sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
          return b.updatedAt - a.updatedAt;
        }),
    }));
    try {
      await api.patchSession(id, { pinned });
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Pin failed.');
    }
  },

  deleteSession: async (id) => {
    try {
      await api.deleteSession(id);
      set((state) => {
        const sessions = state.sessions.filter((item) => item.id !== id);
        const isActive = state.activeSessionId === id;
        if (isActive) localStorage.removeItem('jarvis.session');
        return {
          sessions,
          ...(isActive
            ? {
                session: null,
                activeSessionId: null,
                view: 'core' as View,
                run: null,
                ui: { ...state.ui, cogOpen: false },
              }
            : {}),
        };
      });
      get().addToast('success', 'Channel erased.');
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Delete failed.');
    }
  },

  exportSession: () => {
    const id = get().activeSessionId;
    if (!id) {
      get().addToast('warn', 'No channel is open.');
      return;
    }
    window.open(api.exportSessionUrl(id), '_blank');
    get().addToast('info', 'Markdown transmission opened.');
  },

  saveSettings: async (patch) => {
    try {
      const { settings } = await api.updateSettings(patch);
      set({ settings });
      sfx.success();
      get().addToast('success', 'Core settings committed.');
      return true;
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Settings update failed.');
      return false;
    }
  },

  resetAllData: async () => {
    if (get().run) {
      get().addToast('warn', 'Cancel the active mission before erasing data.');
      return false;
    }
    try {
      const result = await api.resetData();
      localStorage.removeItem('jarvis.session');
      const bootstrap = await api.bootstrap();
      set((state) => ({
        ...bootstrap,
        memories: [],
        artifacts: [],
        session: null,
        activeSessionId: null,
        sessionLoading: false,
        activeAgentId: 'core',
        run: null,
        view: 'core' as View,
        ui: { ...state.ui, cogOpen: false },
      }));
      const { sessions, memories, artifacts, agents } = result.removed;
      const parts = [
        `${sessions} channel${sessions === 1 ? '' : 's'}`,
        `${memories} memor${memories === 1 ? 'y' : 'ies'}`,
        `${artifacts} artifact${artifacts === 1 ? '' : 's'}`,
        `${agents} custom agent${agents === 1 ? '' : 's'}`,
      ];
      get().addToast('success', `Data erased: ${parts.join(', ')}. Workspace cleared.`);
      return true;
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Data erase failed.');
      return false;
    }
  },

  saveProviderKey: async (provider, key) => {
    try {
      const { settings } = await api.saveProviderKey(provider, key);
      set({ settings });
      get().addToast('success', key ? 'Key sealed to local storage.' : 'Key removed.');
      return true;
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Key update failed.');
      return false;
    }
  },

  saveTavilyKey: async (key) => {
    try {
      const { settings } = await api.saveTavilyKey(key);
      set({ settings });
      get().addToast('success', key ? 'Search uplink key saved.' : 'Search uplink key removed.');
      return true;
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Search key update failed.');
      return false;
    }
  },

  saveAgent: async (id, patch) => {
    try {
      if (id) await api.updateAgent(id, patch);
      else await api.createAgent(patch);
      const bootstrap = await api.bootstrap();
      set({ agents: bootstrap.agents, tools: bootstrap.tools });
      sfx.success();
      get().addToast('success', id ? 'Intelligence profile updated.' : 'New intelligence online.');
      return true;
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Agent save failed.');
      return false;
    }
  },

  deleteAgent: async (id) => {
    try {
      await api.deleteAgent(id);
      const bootstrap = await api.bootstrap();
      set({ agents: bootstrap.agents });
      get().addToast('success', 'Agent decommissioned.');
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Agent delete failed.');
    }
  },

  addMemory: async (content, tags, importance) => {
    try {
      const { memory } = await api.createMemory({ content, tags, importance });
      set((state) => ({
        memories: [memory, ...state.memories.filter((item) => item.id !== memory.id)],
        stats: { ...state.stats, memories: state.memories.length + 1 },
      }));
      get().addToast('success', 'Memory committed.');
      return true;
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Memory save failed.');
      return false;
    }
  },

  deleteMemory: async (id) => {
    try {
      await api.deleteMemory(id);
      set((state) => ({
        memories: state.memories.filter((memory) => memory.id !== id),
        stats: { ...state.stats, memories: Math.max(0, state.stats.memories - 1) },
      }));
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Memory delete failed.');
    }
  },

  loadArtifacts: async () => {
    try {
      const { artifacts } = await api.listArtifacts();
      set({ artifacts });
    } catch {
      /* noop */
    }
  },

  deleteArtifact: async (id) => {
    try {
      await api.deleteArtifact(id);
      set((state) => ({
        artifacts: state.artifacts.filter((artifact) => artifact.id !== id),
        session: state.session
          ? {
              ...state.session,
              artifacts: state.session.artifacts.filter((artifactId) => artifactId !== id),
            }
          : state.session,
        stats: { ...state.stats, artifacts: Math.max(0, state.stats.artifacts - 1) },
      }));
      get().addToast('success', 'Artifact purged.');
    } catch (error) {
      get().addToast('error', error instanceof Error ? error.message : 'Artifact delete failed.');
    }
  },

  addToast: (type, message) => {
    const toast: Toast = { id: uid('toast'), type, message };
    set((state) => ({ toasts: [...state.toasts.slice(-3), toast] }));
    window.setTimeout(() => get().dismissToast(toast.id), 4600);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  setUI: (patch) => set((state) => ({ ui: { ...state.ui, ...patch } })),
  toggleSidebar: () => set((state) => ({ ui: { ...state.ui, sidebarOpen: !state.ui.sidebarOpen } })),
  setCogOpen: (open) => set((state) => ({ ui: { ...state.ui, cogOpen: open } })),
  setCogTab: (tab) => set((state) => ({ ui: { ...state.ui, cogTab: tab } })),
  openSettings: () => set((state) => ({ ui: { ...state.ui, settingsOpen: true } })),
  closeSettings: () => set((state) => ({ ui: { ...state.ui, settingsOpen: false } })),
  openPalette: () => set((state) => ({ ui: { ...state.ui, paletteOpen: true } })),
  closePalette: () => set((state) => ({ ui: { ...state.ui, paletteOpen: false } })),
  openAgentModal: (agentId) =>
    set((state) => ({ ui: { ...state.ui, agentModal: { open: true, agentId } } })),
  closeAgentModal: () => set((state) => ({ ui: { ...state.ui, agentModal: { open: false } } })),
  openArtifact: (id) => set((state) => ({ ui: { ...state.ui, artifactId: id } })),
  closeArtifact: () => set((state) => ({ ui: { ...state.ui, artifactId: null } })),
  askConfirm: (confirm: ConfirmState) => set((state) => ({ ui: { ...state.ui, confirm } })),
  closeConfirm: () => set((state) => ({ ui: { ...state.ui, confirm: null } })),
}));

export { ApiError };
