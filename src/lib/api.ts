import type {
  AgentEvent,
  AgentProfile,
  Artifact,
  ArtifactMeta,
  Bootstrap,
  Memory,
  PublicSettings,
  Session,
  SessionSummary,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    throw new ApiError(
      `Unable to reach the core server. ${error instanceof Error ? error.message : ''}`.trim(),
    );
  }
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string; detail?: string };
      if (body.error) message = body.detail ? `${body.error} ${body.detail}` : body.error;
    } catch {
      /* noop */
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),

  createSession: (body: { agentId?: string; title?: string }) =>
    request<{ session: Session }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSession: (id: string) =>
    request<{ session: Session; artifacts: ArtifactMeta[] }>(`/sessions/${id}`),

  listSessions: () => request<{ sessions: SessionSummary[] }>('/sessions'),

  patchSession: (
    id: string,
    patch: { title?: string; agentId?: string; pinned?: boolean },
  ) =>
    request<{ session: Session }>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),

  exportSessionUrl: (id: string) => `/api/sessions/${id}/export`,

  createAgent: (body: Partial<AgentProfile>) =>
    request<{ agent: AgentProfile }>('/agents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAgent: (id: string, body: Partial<AgentProfile>) =>
    request<{ agent: AgentProfile }>(`/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteAgent: (id: string) =>
    request<{ ok: boolean }>(`/agents/${id}`, { method: 'DELETE' }),

  listArtifacts: (sessionId?: string) =>
    request<{ artifacts: ArtifactMeta[] }>(
      `/artifacts${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`,
    ),

  getArtifact: (id: string) => request<{ artifact: Artifact }>(`/artifacts/${id}`),

  deleteArtifact: (id: string) =>
    request<{ ok: boolean }>(`/artifacts/${id}`, { method: 'DELETE' }),

  listMemories: () => request<{ memories: Memory[] }>('/memories'),

  createMemory: (body: { content: string; tags?: string[]; importance?: number }) =>
    request<{ memory: Memory }>('/memories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteMemory: (id: string) =>
    request<{ ok: boolean }>(`/memories/${id}`, { method: 'DELETE' }),

  updateSettings: (patch: Partial<PublicSettings>) =>
    request<{ settings: PublicSettings }>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  saveProviderKey: (provider: string, key: string | null) =>
    request<{ ok: boolean; settings: PublicSettings }>('/settings/key', {
      method: 'POST',
      body: JSON.stringify({ provider, key }),
    }),

  saveTavilyKey: (key: string | null) =>
    request<{ ok: boolean; settings: PublicSettings }>('/settings/tavily', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  testProvider: () =>
    request<{ ok: boolean; latencyMs: number; message: string; model?: string }>(
      '/provider/test',
      { method: 'POST' },
    ),

  resetData: () =>
    request<{
      ok: boolean;
      removed: { sessions: number; memories: number; artifacts: number; agents: number };
    }>('/data/reset', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'ERASE ALL DATA' }),
    }),

  cancelRun: (runId: string) =>
    request<{ ok: boolean }>(`/runs/${runId}/cancel`, { method: 'POST' }),

  resolveApproval: (runId: string, approvalId: string, approved: boolean) =>
    request<{ ok: boolean; approved: boolean }>(`/runs/${runId}/approval/${approvalId}`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    }),

  answerQuestion: (runId: string, questionId: string, answer: string) =>
    request<{ ok: boolean }>(`/runs/${runId}/question/${questionId}`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
};

export async function streamRun(
  sessionId: string,
  input: string,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(
      `Could not open the run stream. ${error instanceof Error ? error.message : ''}`.trim(),
    );
  }

  if (!response.ok) {
    let message = `Run failed to start (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* noop */
    }
    throw new ApiError(message, response.status);
  }
  if (!response.body) {
    throw new ApiError('The core returned an empty stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block: string) => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as AgentEvent);
      } catch (error) {
        console.warn('[sse] malformed event', error);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      dispatch(block);
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) dispatch(buffer);
}
