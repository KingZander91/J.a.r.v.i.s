import type { Usage } from '../../shared/types';
import type { Store } from '../store';
import { PROVIDERS } from '../config';
import { approxTokens, truncate } from '../util';

export interface ProviderToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
  /**
   * Extended provider metadata that must be echoed back on follow-up turns.
   * Gemini 3 attaches `google.thought_signature` here for function calls.
   */
  extraContent?: Record<string, unknown>;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ProviderToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ChatRequest {
  messages: LLMMessage[];
  tools: ProviderToolSchema[];
  signal: AbortSignal;
  onToken?: (delta: string) => void;
  agentName: string;
}

export interface ChatResponse {
  text: string;
  toolCalls: ProviderToolCall[];
  usage: Usage;
  simulated?: boolean;
}

export interface LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly simulated: boolean;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function estimateInput(messages: LLMMessage[], tools: ProviderToolSchema[]): number {
  const text = messages.map((m) => m.content).join('\n') + JSON.stringify(tools);
  return approxTokens(text);
}

function friendlyHttpError(provider: string, status: number, body: string): ProviderError {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    detail =
      (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ||
      parsed.message ||
      '';
  } catch {
    detail = truncate(body, 500);
  }
  const suffix = detail ? ` — ${truncate(detail, 400)}` : '';
  if (status === 401 || status === 403) {
    return new ProviderError(
      `${provider} rejected the API key (HTTP ${status})${suffix}`,
      status,
      'Check the key in Settings → Model. Environment keys take priority over saved keys.',
    );
  }
  if (status === 404) {
    return new ProviderError(
      `${provider} could not find the model or endpoint (HTTP 404)${suffix}`,
      status,
      'Verify the model ID and base URL in Settings → Model.',
    );
  }
  if (status === 429) {
    return new ProviderError(
      `${provider} rate limit reached (HTTP 429)${suffix}`,
      status,
      'Wait a moment, or switch models/providers.',
    );
  }
  return new ProviderError(`${provider} request failed (HTTP ${status})${suffix}`, status);
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return truncate(await response.text(), 4000);
  } catch {
    return '';
  }
}

function joinUrl(base: string, suffix: string): string {
  const clean = base.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}${suffix}`;
}

/* ── OpenAI-compatible ───────────────────────────────────────────── */

export class OpenAICompatibleProvider implements LLMProvider {
  readonly simulated = false;
  readonly label: string;
  constructor(
    readonly id: string,
    label: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly temperature: number,
    private readonly maxTokens: number,
  ) {
    this.label = label;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = joinUrl(this.baseUrl, '/chat/completions');
    const buildBody = (includeUsage: boolean) => ({
      model: this.model,
      messages: request.messages.map((message) => this.toWireMessage(message)),
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: 'auto',
          }
        : {}),
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
      ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.id === 'openrouter') {
      headers['HTTP-Referer'] = 'http://localhost:3000';
      headers['X-Title'] = 'JARVIS Agentic Core';
    }

    let response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(true)),
      signal: request.signal,
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      const retriable =
        response.status === 400 &&
        /stream_options|stream.?usage|unknown field/i.test(body);
      if (retriable) {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(buildBody(false)),
          signal: request.signal,
        });
      }
      if (!response.ok) {
        const retryBody = await readErrorBody(response);
        throw friendlyHttpError(this.label, response.status, retryBody);
      }
    }

    if (!response.body) {
      throw new ProviderError(`${this.label} returned an empty response stream.`);
    }

    let text = '';
    let usage: Usage | undefined;
    const toolAcc = new Map<
      number,
      {
        id: string;
        name: string;
        arguments: string;
        extraContent?: Record<string, unknown>;
      }
    >();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':') || line.startsWith('event:')) continue;
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let chunk: any;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }
          if (chunk.error) {
            throw new ProviderError(
              `${this.label}: ${chunk.error.message || 'stream error'}`,
            );
          }
          if (chunk.usage) {
            usage = {
              inputTokens: Number(chunk.usage.prompt_tokens ?? 0),
              outputTokens: Number(chunk.usage.completion_tokens ?? 0),
            };
          }
          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Some compatible servers send a non-streaming message object.
          if (choice.message) {
            if (choice.message.content) {
              const delta = String(choice.message.content);
              text += delta;
              request.onToken?.(delta);
            }
            for (const [index, call] of (choice.message.tool_calls ?? []).entries()) {
              toolAcc.set(index, {
                id: call.id ?? `call_${index}`,
                name: call.function?.name ?? '',
                arguments: call.function?.arguments ?? '',
                ...(call.extra_content
                  ? { extraContent: call.extra_content as Record<string, unknown> }
                  : {}),
              });
            }
          }

          const delta = choice.delta;
          if (delta) {
            if (typeof delta.content === 'string' && delta.content) {
              text += delta.content;
              request.onToken?.(delta.content);
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const call of delta.tool_calls) {
                const index = Number(call.index ?? 0);
                const existing: {
                  id: string;
                  name: string;
                  arguments: string;
                  extraContent?: Record<string, unknown>;
                } =
                  toolAcc.get(index) ??
                  { id: call.id ?? `call_${index}`, name: '', arguments: '' };
                if (call.id) existing.id = call.id;
                if (call.function?.name) existing.name += call.function.name;
                if (call.function?.arguments)
                  existing.arguments += call.function.arguments;
                if (call.extra_content)
                  existing.extraContent = call.extra_content as Record<string, unknown>;
                toolAcc.set(index, existing);
              }
            }
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* noop */
      }
    }

    const toolCalls = [...toolAcc.values()]
      .filter((call) => call.name)
      .map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments || '{}',
        ...(call.extraContent ? { extraContent: call.extraContent } : {}),
      }));

    if (!text.trim() && !toolCalls.length) {
      throw new ProviderError(
        `${this.label} returned no text or tool calls. The model may not support tool calling or the request may have been filtered.`,
      );
    }

    return {
      text,
      toolCalls,
      usage:
        usage ??
        {
          inputTokens: estimateInput(request.messages, request.tools),
          outputTokens: approxTokens(text),
        },
    };
  }

  private toWireMessage(message: LLMMessage): Record<string, unknown> {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
          ...(call.extraContent ? { extra_content: call.extraContent } : {}),
        })),
      };
    }
    return { role: message.role, content: message.content };
  }
}

/* ── Anthropic ──────────────────────────────────────────────────── */

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic';
  readonly simulated = false;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly temperature: number,
    private readonly maxTokens: number,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = this.toAnthropicMessages(request.messages);
    const url = joinUrl(this.baseUrl, '/messages');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: Math.min(1, this.temperature),
        ...(system ? { system } : {}),
        ...(request.tools.length
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
        stream: true,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw friendlyHttpError(this.label, response.status, await readErrorBody(response));
    }
    if (!response.body) {
      throw new ProviderError('Anthropic returned an empty response stream.');
    }

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
          const dataLine = event
            .split(/\r?\n/)
            .find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          let payload: any;
          try {
            payload = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (payload.type === 'error') {
            throw new ProviderError(
              `Anthropic: ${payload.error?.message || 'stream error'}`,
            );
          }
          if (payload.type === 'message_start') {
            inputTokens = Number(payload.message?.usage?.input_tokens ?? 0);
          }
          if (payload.type === 'content_block_start') {
            const block = payload.content_block;
            if (block?.type === 'tool_use') {
              toolBlocks.set(payload.index, {
                id: block.id,
                name: block.name,
                json: '',
              });
            }
          }
          if (payload.type === 'content_block_delta') {
            const delta = payload.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              text += delta.text;
              request.onToken?.(delta.text);
            }
            if (delta?.type === 'input_json_delta') {
              const existing = toolBlocks.get(payload.index);
              if (existing) existing.json += delta.partial_json ?? '';
            }
          }
          if (payload.type === 'message_delta') {
            outputTokens = Number(payload.usage?.output_tokens ?? outputTokens);
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* noop */
      }
    }

    const toolCalls: ProviderToolCall[] = [...toolBlocks.values()].map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.json || '{}',
    }));

    if (!text.trim() && !toolCalls.length) {
      throw new ProviderError('Anthropic returned no text or tool calls.');
    }

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: inputTokens || estimateInput(request.messages, request.tools),
        outputTokens: outputTokens || approxTokens(text),
      },
    };
  }

  private toAnthropicMessages(messages: LLMMessage[]): {
    system: string;
    messages: any[];
  } {
    const systems: string[] = [];
    const converted: any[] = [];
    for (const message of messages) {
      if (message.role === 'system') {
        systems.push(message.content);
        continue;
      }
      if (message.role === 'user') {
        converted.push({ role: 'user', content: message.content });
        continue;
      }
      if (message.role === 'assistant') {
        const blocks: any[] = [];
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls ?? []) {
          let input: unknown = {};
          try {
            input = JSON.parse(call.arguments || '{}');
          } catch {
            input = {};
          }
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
        }
        if (blocks.length) converted.push({ role: 'assistant', content: blocks });
        continue;
      }
      if (message.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
        };
        const last = converted[converted.length - 1];
        if (last?.role === 'user' && Array.isArray(last.content)) {
          last.content.push(block);
        } else {
          converted.push({ role: 'user', content: [block] });
        }
      }
    }
    return { system: systems.filter(Boolean).join('\n\n'), messages: converted };
  }
}

/* ── Factory ────────────────────────────────────────────────────── */

export interface ProviderFactoryOptions {
  store: Store;
  agentName: string;
  agentCallsign: string;
  demoProvider: LLMProvider;
}

export function createProvider(options: ProviderFactoryOptions): LLMProvider {
  const settings = options.store.getSettings();
  const model = settings.model;
  const preset = PROVIDERS[model.provider] ?? PROVIDERS.demo;

  if (model.provider === 'demo') {
    return options.demoProvider;
  }

  const key = options.store.resolveKey(model.provider);
  if (preset.keyRequired && !key) {
    throw new ProviderError(
      `No API key configured for ${preset.label}.`,
      undefined,
      'Open Settings → Model to add a key, set it in .env, or switch to the simulation core.',
    );
  }

  const baseUrl = (model.baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new ProviderError(
      `No base URL configured for ${preset.label}.`,
      undefined,
      'Set the endpoint URL in Settings → Model.',
    );
  }

  if (preset.native === 'anthropic') {
    return new AnthropicProvider(
      baseUrl,
      key ?? '',
      model.model || preset.model,
      model.temperature,
      model.maxTokens,
    );
  }

  return new OpenAICompatibleProvider(
    model.provider,
    preset.label,
    baseUrl,
    key,
    model.model || preset.model,
    model.temperature,
    model.maxTokens,
  );
}
