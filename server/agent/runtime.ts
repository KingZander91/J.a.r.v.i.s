import type {
  AgentEvent,
  AgentProfile,
  ApprovalRequest,
  ChatMessage,
  PlanTask,
  RunStatus,
  Session,
  ToolCallRecord,
  Usage,
  UserQuestion,
} from '../../shared/types';
import { CANCELLED_RESULT, DENIED_RESULT } from '../../shared/types';
import type { Store } from '../store';
import { now, truncate, uid } from '../util';
import { extractMemoryCandidate } from '../tools/cognition';
import {
  executeTool,
  getTool,
  safeToolsForAgent,
  toolsForAgent,
  type SubagentResult,
  type ToolContext,
  type ToolDefinition,
} from '../tools/registry';
import { buildHistory, buildSystemPrompt } from './prompt';
import { DemoProvider } from './demo';
import {
  createProvider,
  ProviderError,
  type LLMMessage,
  type LLMProvider,
  type ProviderToolCall,
} from './providers';

class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof RunCancelledError ||
    (error instanceof Error &&
      (error.name === 'AbortError' || /abort|cancelled/i.test(error.message)))
  );
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function truncateValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncate(value, 2500);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 3) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => truncateValue(item, depth + 1));
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 24);
  return Object.fromEntries(entries.map(([key, val]) => [key, truncateValue(val, depth + 1)]));
}

function friendlyError(error: unknown): { message: string; hint?: string } {
  if (error instanceof ProviderError) {
    return { message: error.message, hint: error.hint };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

export interface RuntimeOptions {
  store: Store;
  sessionId: string;
  agentId: string;
  runId: string;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
}

interface PendingApproval {
  approval: ApprovalRequest;
  finish: (approved: boolean) => void;
}

interface PendingQuestion {
  question: UserQuestion;
  finish: (answer: string) => void;
}

export class AgentRuntime {
  private readonly store: Store;
  private readonly session: Session;
  private readonly agent: AgentProfile;
  private readonly runId: string;
  private readonly signal: AbortSignal;
  private readonly emit: (event: AgentEvent) => void;
  private readonly settings;
  private readonly simulated: boolean;
  private readonly modelLabel: string;
  private readonly startedAt = now();
  private readonly assistantMessageId = uid('msg_');
  private readonly parts: string[] = [];
  private readonly records: ToolCallRecord[] = [];
  private readonly artifacts = new Set<string>();
  private readonly usage: Usage = { inputTokens: 0, outputTokens: 0 };
  private plan: PlanTask[] = [];
  private approvals = new Map<string, PendingApproval>();
  private questions = new Map<string, PendingQuestion>();
  private provider: LLMProvider | null = null;
  private userInput = '';
  private lastError: string | undefined;
  private finalState: 'completed' | 'failed' | 'cancelled' | 'max_steps' = 'completed';
  private closed = false;

  constructor(options: RuntimeOptions) {
    const session = options.store.getSession(options.sessionId);
    const agent = options.store.getAgent(options.agentId);
    if (!session) throw new Error('Session not found.');
    if (!agent) throw new Error('Agent not found.');
    this.store = options.store;
    this.session = session;
    this.agent = agent;
    this.runId = options.runId;
    this.signal = options.signal;
    this.emit = options.emit;
    this.settings = options.store.getSettings();
    this.simulated = this.settings.model.provider === 'demo';
    this.modelLabel = this.simulated
      ? 'Simulation Core'
      : this.settings.model.model || 'language model';
  }

  /* ── Decisions (called by HTTP layer) ─────────────────────────── */

  resolveApproval(id: string, approved: boolean): boolean {
    const pending = this.approvals.get(id);
    if (!pending) return false;
    pending.finish(approved);
    return true;
  }

  answerQuestion(id: string, answer: string): boolean {
    const pending = this.questions.get(id);
    if (!pending) return false;
    pending.finish(answer);
    return true;
  }

  getRunId(): string {
    return this.runId;
  }

  /* ── Main loop ────────────────────────────────────────────────── */

  async run(input: string): Promise<void> {
    this.userInput = input.trim();
    const userMessage: ChatMessage = {
      id: uid('msg_'),
      role: 'user',
      content: this.userInput,
      createdAt: now(),
    };
    this.store.appendMessage(this.session.id, userMessage);

    this.emit({
      type: 'run_started',
      runId: this.runId,
      sessionId: this.session.id,
      agent: {
        id: this.agent.id,
        name: this.agent.name,
        callsign: this.agent.callsign,
        accent: this.agent.accent,
        icon: this.agent.icon,
      },
      userMessage,
      simulated: this.simulated,
      model: this.modelLabel,
      startedAt: this.startedAt,
    });

    // Each run gets a fresh visible plan.
    this.plan = [];
    this.store.setSessionPlan(this.session.id, []);
    this.emit({ type: 'plan', tasks: [] });

    try {
      this.provider = createProvider({
        store: this.store,
        agentName: this.agent.name,
        agentCallsign: this.agent.callsign,
        demoProvider: new DemoProvider(this.agent.name, this.agent.callsign),
      });
    } catch (error) {
      const friend = friendlyError(error);
      await this.finalize('failed', friend.message, friend.hint);
      return;
    }

    try {
      await this.loop();
    } catch (error) {
      if (isAbortLike(error) || this.signal.aborted) {
        await this.finalize('cancelled');
        return;
      }
      const friend = friendlyError(error);
      console.error(`[run ${this.runId}] failed:`, error);
      await this.finalize('failed', friend.message, friend.hint);
    }
  }

  private async loop(): Promise<void> {
    if (!this.provider) throw new Error('Provider not initialized.');
    const settings = this.settings;
    const tools = toolsForAgent(this.agent);
    const providerTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

    const memories = this.store.searchMemories(this.userInput, 5);
    const systemPrompt = buildSystemPrompt({
      agent: this.agent,
      settings,
      memories,
      sessionTitle: this.session.title,
      artifacts: this.session.artifacts
        .map((id) => this.store.getArtifact(id))
        .filter(Boolean)
        .slice(-8)
        .map((artifact) => ({ title: artifact!.title, type: artifact!.type })),
      simulated: this.simulated,
      modelLabel: this.modelLabel,
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...buildHistory(this.session.messages).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const toolContext = this.buildToolContext();

    let completed = false;
    for (let step = 0; step < settings.maxSteps; step += 1) {
      if (this.signal.aborted) throw new RunCancelledError();
      this.emitStatus(
        'thinking',
        step === 0
          ? 'Analyzing the mission'
          : `Step ${step + 1} · evaluating results`,
      );

      const response = await this.provider.chat({
        messages,
        tools: providerTools,
        signal: this.signal,
        agentName: this.agent.name,
        onToken: (delta) => {
          this.emit({
            type: 'assistant_delta',
            messageId: this.assistantMessageId,
            delta,
          });
        },
      });

      this.usage.inputTokens += response.usage.inputTokens;
      this.usage.outputTokens += response.usage.outputTokens;
      if (response.text.trim()) this.parts.push(response.text.trim());

      if (!response.toolCalls.length) {
        completed = true;
        break;
      }

      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });

      this.emitStatus('acting', `Executing ${response.toolCalls.length} action${response.toolCalls.length === 1 ? '' : 's'}`);
      await this.runToolCalls(response.toolCalls, messages, toolContext, tools);

      if (step === settings.maxSteps - 1) {
        this.emit({
          type: 'notice',
          level: 'warn',
          text: `Step budget reached (${settings.maxSteps}). The run is paused before completion.`,
        });
      }
    }

    if (completed) {
      await this.finalize('completed');
    } else {
      await this.finalize('max_steps');
    }
  }

  private async runToolCalls(
    calls: ProviderToolCall[],
    messages: LLMMessage[],
    ctx: ToolContext,
    tools: ToolDefinition[],
  ): Promise<void> {
    for (const call of calls) {
      if (this.signal.aborted) throw new RunCancelledError();
      const definition = tools.find((tool) => tool.name === call.name);
      let args: Record<string, unknown> = {};
      let argError: string | null = null;
      try {
        args = parseArgs(call.arguments);
      } catch (error) {
        argError = error instanceof Error ? error.message : 'Invalid arguments.';
      }

      const record: ToolCallRecord = {
        id: call.id || uid('call_'),
        name: call.name,
        category: definition?.category,
        args: truncateValue(args),
        status: 'running',
        startedAt: now(),
        requiresApproval: definition?.requiresApproval ?? false,
      };
      this.records.push(record);
      this.emit({
        type: 'tool_call',
        call: { ...record, resultPreview: undefined } as ToolCallRecord,
      });

      if (argError) {
        record.status = 'error';
        record.error = argError;
        record.finishedAt = now();
        record.durationMs = 0;
        this.emit({
          type: 'tool_update',
          callId: record.id,
          status: 'error',
          error: argError,
          finishedAt: record.finishedAt,
          durationMs: 0,
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: `TOOL ERROR: invalid arguments — ${argError}`,
        });
        continue;
      }

      if (!definition) {
        const error = `Unknown tool "${call.name}". Available tools: ${tools.map((t) => t.name).join(', ')}.`;
        record.status = 'error';
        record.error = error;
        record.finishedAt = now();
        this.emit({ type: 'tool_update', callId: record.id, status: 'error', error });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: `TOOL ERROR: ${error}`,
        });
        continue;
      }

      if (definition.requiresApproval && !this.settings.yoloMode) {
        record.status = 'awaiting_approval';
        this.emit({ type: 'tool_update', callId: record.id, status: 'awaiting_approval' });
        const approved = await this.requestApproval(definition, args);
        if (!approved) {
          record.status = 'denied';
          record.finishedAt = now();
          record.durationMs = 0;
          this.emit({
            type: 'tool_update',
            callId: record.id,
            status: 'denied',
            error: 'Action denied by operator.',
            finishedAt: record.finishedAt,
            durationMs: 0,
          });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: DENIED_RESULT,
          });
          continue;
        }
        this.emitStatus('acting', `Authorized ${call.name} · executing`);
      }

      const started = now();
      this.emit({ type: 'tool_update', callId: record.id, status: 'running' });
      try {
        const result = await executeTool(definition, args, ctx);
        const durationMs = now() - started;
        record.status = 'success';
        record.finishedAt = now();
        record.durationMs = durationMs;
        record.summary = result.summary;
        record.resultPreview = truncate(result.content, 1600);
        if (result.artifact) {
          this.artifacts.add(result.artifact.id);
        }
        this.emit({
          type: 'tool_update',
          callId: record.id,
          status: 'success',
          summary: result.summary,
          resultPreview: truncate(result.content, 1600),
          finishedAt: record.finishedAt,
          durationMs,
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: result.content,
        });
      } catch (error) {
        if (this.signal.aborted) throw new RunCancelledError();
        const message = error instanceof Error ? error.message : String(error);
        const durationMs = now() - started;
        record.status = 'error';
        record.error = message;
        record.finishedAt = now();
        record.durationMs = durationMs;
        this.emit({
          type: 'tool_update',
          callId: record.id,
          status: 'error',
          error: message,
          finishedAt: record.finishedAt,
          durationMs,
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: `TOOL ERROR: ${message}`,
        });
      }
    }
    this.emitStatus('thinking', 'Synthesizing results');
  }

  /* ── Approvals & questions ────────────────────────────────────── */

  private requestApproval(
    definition: ToolDefinition,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    const id = uid('apr_');
    const timeoutMs = this.settings.approvalTimeoutMs;
    const approval: ApprovalRequest = {
      id,
      runId: this.runId,
      toolName: definition.name,
      category: definition.category,
      args,
      reason:
        definition.approvalReason?.(args) ??
        `${definition.name} is a protected action and requires human authorization.`,
      expiresAt: now() + timeoutMs,
    };

    this.emitStatus('awaiting_approval', `Authorization required · ${definition.name}`);
    this.emit({ type: 'approval', approval });

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (approved: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.signal.removeEventListener('abort', onAbort);
        this.approvals.delete(id);
        this.emit({ type: 'approval_resolved', approvalId: id, approved });
        resolve(approved);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const onAbort = () => finish(false);
      this.signal.addEventListener('abort', onAbort, { once: true });
      this.approvals.set(id, { approval, finish });
    });
  }

  private requestUserInput(question: string, options?: string[]): Promise<string> {
    const id = uid('qst_');
    const timeoutMs = this.settings.approvalTimeoutMs;
    const pendingQuestion: UserQuestion = {
      id,
      runId: this.runId,
      question,
      options,
      expiresAt: now() + timeoutMs,
    };
    this.emitStatus('awaiting_input', 'Operator input requested');
    this.emit({ type: 'question', question: pendingQuestion });

    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = (answer: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.signal.removeEventListener('abort', onAbort);
        this.questions.delete(id);
        this.emit({ type: 'question_resolved', questionId: id });
        resolve(answer);
      };
      const timer = setTimeout(() => finish(''), timeoutMs);
      const onAbort = () => finish('');
      this.signal.addEventListener('abort', onAbort, { once: true });
      this.questions.set(id, { question: pendingQuestion, finish });
    });
  }

  /* ── Tool context & subagents ─────────────────────────────────── */

  private buildToolContext(depth = 0): ToolContext {
    return {
      store: this.store,
      sessionId: this.session.id,
      runId: this.runId,
      agent: this.agent,
      signal: this.signal,
      emit: (event) => this.emit(event),
      setPlan: (tasks) => {
        this.plan = tasks;
        this.store.setSessionPlan(this.session.id, tasks);
        this.emit({ type: 'plan', tasks });
      },
      askUser: (question, options) => this.requestUserInput(question, options),
      spawnAgent: (agentRef, task, maxSteps) => this.spawnSubagent(agentRef, task, maxSteps),
      depth,
    };
  }

  private async spawnSubagent(
    agentRef: string,
    task: string,
    maxSteps: number,
  ): Promise<SubagentResult> {
    if (this.emit === undefined) throw new Error('Subagents unavailable.');
    const normalized = agentRef.trim().toLowerCase();
    const childAgent = this.store
      .listAgents()
      .find(
        (candidate) =>
          candidate.id.toLowerCase() === normalized ||
          candidate.callsign.toLowerCase() === normalized ||
          candidate.name.toLowerCase() === normalized,
      );
    if (!childAgent) {
      throw new Error(
        `Unknown specialist "${agentRef}". Available: ${this.store
          .listAgents()
          .map((a) => a.callsign)
          .join(', ')}.`,
      );
    }
    if (childAgent.id === this.agent.id) {
      throw new Error('An agent cannot delegate to itself. Choose a specialist (ORACLE, FORGE, SCRIBE, SENTINEL).');
    }

    const excluded = new Set([
      'run_javascript',
      'workspace_write',
      'workspace_list',
      'spawn_agent',
      'ask_user',
      'update_plan',
    ]);
    const tools = safeToolsForAgent(childAgent).filter((tool) => !excluded.has(tool.name));
    const provider = createProvider({
      store: this.store,
      agentName: childAgent.name,
      agentCallsign: childAgent.callsign,
      demoProvider: new DemoProvider(childAgent.name, childAgent.callsign),
    });

    this.emit({
      type: 'subagent',
      phase: 'started',
      agentName: childAgent.callsign,
      task: truncate(task, 300),
    });

    const childArtifacts: string[] = [];
    const childMessages: LLMMessage[] = [
      {
        role: 'system',
        content: `${buildSystemPrompt({
          agent: childAgent,
          settings: { ...this.settings, maxSteps },
          memories: this.store.searchMemories(task, 4),
          sessionTitle: `Delegated task · ${this.session.title}`,
          artifacts: [],
          simulated: this.simulated,
          modelLabel: this.modelLabel,
        })}

────────────────────────────────────────
DELEGATION BRIEF
────────────────────────────────────────
You are executing a scoped mission delegated by CORE. Work independently, stay inside the task, and return a compact, decision-useful brief. Create an artifact only if the deliverable is substantial. Clearly flag anything you could not verify. Do not attempt to delegate further.`,
      },
      {
        role: 'user',
        content: task,
      },
    ];

    let steps = 0;
    let finalText = '';
    const collected: string[] = [];
    const childEmit = (event: AgentEvent) => {
      if (event.type === 'artifact') {
        childArtifacts.push(event.artifact.id);
        this.emit(event);
      } else if (event.type === 'memory') {
        this.emit(event);
      }
    };
    const childCtx: ToolContext = {
      store: this.store,
      sessionId: this.session.id,
      runId: this.runId,
      agent: childAgent,
      signal: this.signal,
      emit: childEmit,
      setPlan: () => undefined,
      askUser: async () => '',
      spawnAgent: async () => {
        throw new Error('Nested delegation is not permitted.');
      },
      depth: 1,
    };

    for (let step = 0; step < Math.min(6, Math.max(1, maxSteps)); step += 1) {
      if (this.signal.aborted) throw new RunCancelledError();
      const response = await provider.chat({
        messages: childMessages,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
        signal: this.signal,
        agentName: childAgent.name,
      });
      this.usage.inputTokens += response.usage.inputTokens;
      this.usage.outputTokens += response.usage.outputTokens;
      steps += 1;
      if (response.text.trim()) collected.push(response.text.trim());
      if (!response.toolCalls.length) {
        finalText = collected.join('\n\n');
        break;
      }
      childMessages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });
      for (const call of response.toolCalls) {
        if (this.signal.aborted) throw new RunCancelledError();
        const definition = tools.find((tool) => tool.name === call.name);
        if (!definition) {
          childMessages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: `TOOL ERROR: "${call.name}" is not available to this specialist.`,
          });
          continue;
        }
        try {
          const args = parseArgs(call.arguments);
          const result = await executeTool(definition, args, childCtx);
          if (result.artifact) childArtifacts.push(result.artifact.id);
          childMessages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: result.content,
          });
        } catch (error) {
          childMessages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: `TOOL ERROR: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      if (step === Math.min(6, Math.max(1, maxSteps)) - 1) {
        finalText =
          collected.join('\n\n') ||
          'The specialist exhausted its step budget without a final summary.';
      }
    }

    this.emit({
      type: 'subagent',
      phase: 'finished',
      agentName: childAgent.callsign,
      task: truncate(task, 200),
      result: truncate(finalText || 'No summary produced.', 800),
    });

    return {
      agent: childAgent.id,
      callsign: childAgent.callsign,
      result: truncate(finalText || 'No summary produced.', 12_000),
      steps,
      artifacts: [...new Set(childArtifacts)],
      artifactMeta: childArtifacts.length
        ? this.store.listArtifacts(this.session.id).find((a) => a.id === childArtifacts[0])
        : undefined,
    };
  }

  /* ── Finalization ─────────────────────────────────────────────── */

  private emitStatus(status: RunStatus, detail?: string): void {
    this.emit({ type: 'status', status, detail });
  }

  private async finalize(
    state: 'completed' | 'failed' | 'cancelled' | 'max_steps',
    errorMessage?: string,
    errorHint?: string,
  ): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.finalState = state;

    // Close out the plan honestly.
    if (this.plan.length) {
      this.plan = this.plan.map((task) => {
        if (state === 'completed') {
          if (task.status === 'in_progress') return { ...task, status: 'done' };
          if (task.status === 'pending')
            return { ...task, status: 'skipped', note: task.note ?? 'Not required once the mission concluded.' };
        }
        return task;
      });
      this.store.setSessionPlan(this.session.id, this.plan);
      this.emit({ type: 'plan', tasks: this.plan });
    }

    const latencyMs = now() - this.startedAt;
    let content = this.parts.join('\n\n').trim();

    if (state === 'cancelled') {
      content = content
        ? `${content}\n\n---\n\n_Run stopped by the operator. Partial output preserved._`
        : '_Run stopped by the operator before a response was produced._';
    } else if (state === 'failed') {
      const errorBlock = `## Link interrupted\n\n${errorMessage || 'The run failed before completion.'}${
        errorHint ? `\n\n> ${errorHint}` : ''
      }\n\n_No further actions were taken. Any partial output above is preserved._`;
      content = content ? `${content}\n\n---\n\n${errorBlock}` : errorBlock;
    } else if (state === 'max_steps') {
      const note = `\n\n---\n\n**Step budget reached.** The agent executed ${this.records.length} action(s) but did not converge on a final answer. Review the activity log, then continue the mission or increase Max Steps in Settings.`;
      content = content ? `${content}${note}` : note.trim();
    }

    if (!content) {
      content =
        this.records.length > 0
          ? 'Actions completed, but the model produced no final summary. Inspect the activity log for tool output.'
          : 'No response was produced.';
    }

    const recordSnapshot = this.records.map((record) => ({
      ...record,
      args: truncateValue(record.args),
      resultPreview: record.resultPreview ? truncate(record.resultPreview, 1500) : undefined,
    }));

    const finalMessage: ChatMessage = {
      id: this.assistantMessageId,
      role: 'assistant',
      content,
      createdAt: now(),
      agentId: this.agent.id,
      agentName: this.agent.name,
      agentCallsign: this.agent.callsign,
      runId: this.runId,
      toolCalls: recordSnapshot,
      artifacts: [...this.artifacts],
      usage: { ...this.usage },
      latencyMs,
      simulated: this.simulated,
      ...(state === 'failed' ? { error: errorMessage } : {}),
    };

    this.store.appendMessage(this.session.id, finalMessage);
    this.store.incrementRun(this.session.id);
    this.lastError = errorMessage;

    // Passive memory extraction (explicit save_memory takes precedence via dedupe).
    if (this.settings.autoMemory && state === 'completed') {
      try {
        const candidate = extractMemoryCandidate(this.userInput);
        if (candidate) {
          const exists = this.store
            .listMemories()
            .some((memory) => memory.content.toLowerCase() === candidate.toLowerCase());
          if (!exists) {
            const memory = this.store.addMemory({
              content: candidate,
              tags: ['auto-extracted'],
              importance: 3,
              sourceSessionId: this.session.id,
              sourceAgentId: this.agent.id,
            });
            this.emit({ type: 'memory', memory });
          }
        }
      } catch {
        /* memory extraction is best-effort */
      }
    }

    // Resolve any dangling decisions.
    for (const pending of [...this.approvals.values()]) {
      pending.finish(false);
    }
    for (const pending of [...this.questions.values()]) {
      pending.finish('');
    }

    this.emit({
      type: 'run_end',
      runId: this.runId,
      status: state,
      message: finalMessage,
      ...(errorMessage ? { error: errorMessage } : {}),
      usage: { ...this.usage },
      latencyMs,
    });
  }
}
