const AGENT_SUGGESTIONS: Record<string, string[]> = {
  core: [
    'Research the current state of open-source AI agents and brief me with sources.',
    'Design a 30-day launch plan for a personal AI command center.',
    'Remember that I prefer concise answers with sources for technical claims.',
  ],
  oracle: [
    'Compare the leading open-weight models released this year, with sources.',
    'Brief me on the latest breakthroughs in fusion energy.',
    'Fact-check the claim that remote work reduces team velocity.',
  ],
  forge: [
    'Write and run a JavaScript function that detects palindromes.',
    'Debug this approach: how should I model a rate limiter in TypeScript?',
    'Build a small scheduler and test it in the sandbox.',
  ],
  scribe: [
    'Draft a launch announcement for an agentic AI command center.',
    'Write a concise executive brief on our Q4 priorities.',
    'Turn these notes into a polished one-page memo.',
  ],
  sentinel: [
    'Audit the risks of exposing an agent runtime to the public internet.',
    'Review this architecture for single points of failure.',
    'Build a go / no-go checklist for shipping an AI assistant.',
  ],
  ultron: [
    'Tell me three pieces of Marvel trivia from the built-in archive.',
    'Who created Ultron, and when did he first appear?',
    'Reconcile the Infinity Stones across comics and the MCU.',
  ],
};

const DEFAULT_SUGGESTIONS = [
  'Analyze this objective and propose an execution plan.',
  'Research the latest developments and cite your sources.',
  'Remember a durable fact about this project.',
];

export function suggestionsForAgent(agentId?: string): string[] {
  return (agentId && AGENT_SUGGESTIONS[agentId]) || DEFAULT_SUGGESTIONS;
}

export function suggestionsForAgents(agent?: { id: string }): string[] {
  return suggestionsForAgent(agent?.id);
}
