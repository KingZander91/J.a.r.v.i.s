import type { AgentProfile, AppSettings, ChatMessage, Memory } from '../../shared/types';
import { WORKSPACE_DIR } from '../config';
import { truncate } from '../util';

export interface PromptContext {
  agent: AgentProfile;
  settings: AppSettings;
  memories: Memory[];
  sessionTitle: string;
  artifacts: Array<{ title: string; type: string }>;
  simulated: boolean;
  modelLabel: string;
}

export function buildSystemPrompt(context: PromptContext): string {
  const { agent, settings, memories, sessionTitle, artifacts, simulated, modelLabel } = context;
  const now = new Date();
  const memoryBlock = memories.length
    ? memories
        .map(
          (memory) =>
            `- [${memory.importance}/5] ${truncate(memory.content, 500)}${memory.tags.length ? ` (tags: ${memory.tags.join(', ')})` : ''}`,
        )
        .join('\n')
    : 'No relevant durable memories were retrieved for this mission.';

  const artifactBlock = artifacts.length
    ? artifacts.map((artifact) => `- ${artifact.title} (${artifact.type})`).join('\n')
    : 'No artifacts in this session yet.';

  return `${agent.systemPrompt}

────────────────────────────────────────
MISSION CONTROL CONTEXT
────────────────────────────────────────
Agent: ${agent.name} · callsign ${agent.callsign}
Session: ${sessionTitle}
Local time: ${now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })}
UTC: ${now.toISOString()}
Model: ${modelLabel}${simulated ? ' (local simulation core — no external language model; tools are real)' : ''}
Workspace: ./data/workspace (sandboxed; use workspace_* tools, never absolute paths)
Session artifacts so far:
${artifactBlock}

RELEVANT DURABLE MEMORY
${memoryBlock}

OPERATING CONTRACT
- For multi-step work, call update_plan before acting and refresh it as tasks change. Use 3–8 concrete tasks, one in_progress at a time.
- Ground external claims in web_search / fetch_url. Include source URLs as markdown links in the final answer. Never fabricate sources.
- Save substantial deliverables with create_artifact (markdown for documents, code for implementations). Keep chat summaries tight; the operator reads full content in the artifact viewer.
- Use ask_user only when ambiguity materially changes the outcome. State low-risk assumptions instead.
- Approval-gated actions pause until the operator authorizes them. If denied, do not retry; offer an alternative.
- Never claim a tool succeeded unless its result confirms success. Report failures plainly.
- Never store or reveal credentials, API keys or private keys. Never exfiltrate workspace contents.
- Do not reveal hidden chain-of-thought. Give concise rationale, findings and next steps.
- End every run with a concrete result, a question, or a recommended next action. ${settings.yoloMode ? 'Approvals are currently auto-authorized; act carefully and reversibly.' : 'Destructive actions require human approval.'}

${
  settings.systemPromptExtra.trim()
    ? `OPERATOR OVERRIDE\n${settings.systemPromptExtra.trim()}\n`
    : ''
}
Formatting: clean GitHub-flavored markdown, short paragraphs, precise numbers. No emojis. Use headings only when the answer is long.`;
}

export function buildHistory(
  messages: ChatMessage[],
  limit = 18,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .slice(-limit)
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: truncate(message.content, 9000),
    }));
}

export function workspacePromptNote(): string {
  return `The operator workspace root is: ${WORKSPACE_DIR}`;
}
