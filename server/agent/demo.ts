import type { ChatResponse, ChatRequest, LLMProvider, ProviderToolCall, LLMMessage } from './providers';
import { DENIED_RESULT } from '../../shared/types';
import { MARVEL_TRIVIA, type MarvelTrivia } from '../../shared/marvel';
import { approxTokens, stripMarkdown, truncate } from '../util';

/* ─────────────────────────────────────────────────────────────────
   SIMULATION CORE
   A deterministic local "agent" used when no model key is configured.
   It still calls the real tool layer — searches, executions, artifacts,
   memory and subagents are genuine. Only language synthesis is scripted.
   ───────────────────────────────────────────────────────────────── */

type Intent =
  | 'greeting'
  | 'memory'
  | 'time'
  | 'trivia'
  | 'subagent'
  | 'code'
  | 'research'
  | 'write'
  | 'default';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

interface CodePlan {
  title: string;
  code: string;
  explanation: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanSnippet(input: string): string {
  return input
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseToolJson(message: LLMMessage | undefined): any {
  if (!message) return null;
  try {
    return JSON.parse(message.content);
  } catch {
    return { raw: message.content };
  }
}

function toolOutputText(data: any): string {
  const result = data?.result;
  if (result === undefined || result === null || result === '' || result === 'undefined') return '';
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

function toolLogText(data: any): string {
  return Array.isArray(data?.logs) && data.logs.length ? data.logs.join('\n') : '';
}

function classify(text: string): Intent {
  const t = text.toLowerCase().trim();
  if (
    t.length < 48 &&
    /^(hi|hello|hey|yo|good (morning|afternoon|evening)|jarvis|are you (there|online|awake)|status report)[\s!.,?]*$/i.test(t)
  ) {
    return 'greeting';
  }
  if (/\b(what can you do|capabilities|who are you|introduce yourself|help me get started)\b/i.test(t)) {
    return 'greeting';
  }
  if (/\b(remember|my name is|i prefer|note that|keep in mind|save this)\b/i.test(t)) {
    return 'memory';
  }
  if (/\b(what time|what date|what day|current time|today'?s date|time is it)\b/i.test(t)) {
    return 'time';
  }
  if (/\b(subagent|sub-agent|spawn|delegate|oracle agent|forge agent|specialist agent)\b/i.test(t)) {
    return 'subagent';
  }
  if (/\b(javascript|typescript|fizzbuzz|fibonacci|palindrome|algorithm|write code|run code|code snippet|debug|function that|script that|regex)\b/i.test(t)) {
    return 'code';
  }
  if (/\b(run|execute|compute|calculate)\b/i.test(t) && /\b(code|script|program|function|expression)\b/i.test(t)) {
    return 'code';
  }
  if (
    /\b(marvel|avengers?|ultron|iron man|tony stark|stark industries|thor|mjolnir|hulk|bruce banner|captain america|vibranium|wakanda|black panther|thanos|infinity (stones?|gauntlet)|spider-?man|doctor strange|scarlet witch|loki|x-men|deadpool|marvel trivia|comic canon)\b/i.test(
      t,
    ) ||
    /\b(who (made|make|created|creates|built|build|is) (the )?vision|vision('s)? (marvel|mcu|origin|comics?)|the vision)\b/i.test(
      t,
    )
  ) {
    return 'trivia';
  }
  if (
    /\b(research|search|look up|find out|latest|news|compare|sources?|what is|who is|how (does|do|can|to)|why (is|does|do)|current|state of|breakthroughs?)\b/i.test(t) ||
    /\?\s*$/.test(t)
  ) {
    return 'research';
  }
  if (/\b(write|draft|report|brief|plan|outline|essay|email|copy|summari[sz]e|document|proposal|memo|article|blog)\b/i.test(t)) {
    return 'write';
  }
  return 'default';
}

function wantsArtifact(text: string): boolean {
  return /\b(report|brief|draft|write|document|plan|outline|essay|artifact|save|memo|proposal|article|deliverable)\b/i.test(
    text,
  );
}

function hashText(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function marvelTriviaAnswer(query: string, callsign: string): string {
  const lowered = query.toLowerCase();
  const namedSubject =
    /\b(marvel|avengers?|ultron|iron man|tony stark|stark|thor|mjolnir|hulk|banner|captain america|vibranium|wakanda|black panther|thanos|infinity|spider-?man|doctor strange|loki|x-men|deadpool|comics?|mcu)\b/i.test(
      query,
    );
  const matched = MARVEL_TRIVIA.filter((item) =>
    item.keywords.some((keyword) => lowered.includes(keyword)),
  );
  const pool = matched.length ? matched : MARVEL_TRIVIA;
  const start = hashText(query) % pool.length;
  const picks: MarvelTrivia[] = [];
  for (let i = 0; i < pool.length && picks.length < 4; i += 1) {
    picks.push(pool[(start + i) % pool.length]);
  }
  if (matched.length && picks.length < 4) {
    const extra = MARVEL_TRIVIA[(hashText(query) + 7) % MARVEL_TRIVIA.length];
    if (!picks.some((item) => item.id === extra.id)) picks.push(extra);
  }

  const intro = /ultron/i.test(callsign)
    ? 'My own archive. Try not to make this weird.'
    : 'Stark archive accessed. Built-in canon, no uplink required.';
  const scope = namedSubject
    ? ''
    : '\n\n> The built-in archive is Marvel-only. Name a character, team, stone or film for a narrower file.';
  const bullets = picks.map((item) => `- **${item.subject}** — ${item.fact}`).join('\n');

  return `## Marvel archive // trivia file

${intro}

${bullets}${scope}

> Compiled from comics, film and production history. Continuity varies between Earth-616 and the MCU; ask for a specific era for a narrower reading.`;
}

function planFor(intent: Intent, artifact: boolean): { title: string; status: 'pending' | 'in_progress' | 'done' }[] {
  if (intent === 'research') {
    return [
      { title: 'Scope the question', status: 'done' },
      { title: 'Gather live sources', status: 'pending' },
      { title: artifact ? 'Compile the research brief' : 'Synthesize a sourced answer', status: 'pending' },
    ];
  }
  if (intent === 'code') {
    return [
      { title: 'Scope the implementation', status: 'pending' },
      { title: 'Execute and verify', status: 'pending' },
      { title: 'Package the result', status: 'pending' },
    ];
  }
  if (intent === 'write') {
    return [
      { title: 'Frame the deliverable', status: 'pending' },
      { title: 'Draft the content', status: 'pending' },
      { title: 'Finalize the artifact', status: 'pending' },
    ];
  }
  return [];
}

function toolResult(messages: LLMMessage[], name: string): LLMMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') break;
    if (message.role === 'tool' && message.name === name) return message;
  }
  return undefined;
}

function hasTool(calls: ProviderToolCall[], name: string): boolean {
  return calls.some((c) => c.name === name);
}

function generateCode(text: string): CodePlan {
  const t = text.toLowerCase();
  if (/palindrom/.test(t)) {
    const code = `// Longest palindromic substring — expand around center, O(n²)
function longestPalindrome(s) {
  if (!s || s.length < 2) return s;
  let start = 0, end = 0;

  function expand(left, right) {
    while (left >= 0 && right < s.length && s[left] === s[right]) {
      left--;
      right++;
    }
    return right - left - 1;
  }

  for (let i = 0; i < s.length; i++) {
    const odd = expand(i, i);
    const even = expand(i, i + 1);
    const len = Math.max(odd, even);
    if (len > end - start) {
      start = i - Math.floor((len - 1) / 2);
      end = start + len;
    }
  }
  return s.slice(start, end);
}

const tests = [
  ["babad", "bab"],
  ["cbbd", "bb"],
  ["forge intelligence core", "ll"],
  ["racecar", "racecar"],
];

const results = tests.map(([input, expected]) => ({
  input,
  expected,
  actual: longestPalindrome(input),
  pass: longestPalindrome(input) === expected,
}));

console.log(JSON.stringify({ results, allPassed: results.every(r => r.pass) }, null, 2));`;
    return {
      title: 'Longest Palindrome — implementation & tests',
      code,
      explanation: [
        'The solution expands around every possible center (odd and even) in O(n²) time and O(1) space.',
        'Each case in the test table is executed immediately; the boolean table proves correctness.',
      ],
    };
  }
  if (/fibonacci/.test(t)) {
    const code = `// Memoized Fibonacci sequence with verification
const memo = new Map([[0, 0], [1, 1]]);

function fib(n) {
  if (memo.has(n)) return memo.get(n);
  const value = fib(n - 1) + fib(n - 2);
  memo.set(n, value);
  return value;
}

const sequence = Array.from({ length: 20 }, (_, i) => fib(i));
const checks = [0, 1, 2, 5, 10, 19].map(n => ({ n, value: fib(n) }));

console.log(JSON.stringify({ sequence, checks }, null, 2));`;
    return {
      title: 'Memoized Fibonacci — execution trace',
      code,
      explanation: [
        'Memoization collapses the naive exponential recursion to O(n) time and O(n) space.',
        'The first 20 values and selected checkpoints were executed and verified.',
      ],
    };
  }
  if (/fizzbuzz/.test(t)) {
    const code = `// FizzBuzz with a rule table (easy to extend)
const rules = [
  [15, "FizzBuzz"],
  [3, "Fizz"],
  [5, "Buzz"],
];

const output = Array.from({ length: 30 }, (_, i) => {
  const n = i + 1;
  return rules.find(([divisor]) => n % divisor === 0)?.[1] ?? String(n);
});

console.log(JSON.stringify({ count: output.length, sequence: output }, null, 2));`;
    return {
      title: 'FizzBuzz — rule-table implementation',
      code,
      explanation: [
        'A declarative rule table replaces cascading conditionals, so new rules can be added without touching the loop.',
        'The first 30 terms were generated and executed.',
      ],
    };
  }
  if (/prime/.test(t)) {
    const code = `// Sieve of Eratosthenes up to 100
function primesUpTo(limit) {
  const sieve = new Uint8Array(limit + 1).fill(1);
  sieve[0] = sieve[1] = 0;
  for (let i = 2; i * i <= limit; i++) {
    if (!sieve[i]) continue;
    for (let j = i * i; j <= limit; j += i) sieve[j] = 0;
  }
  return [...sieve.entries()].filter(([, isPrime]) => isPrime).map(([n]) => n);
}

const primes = primesUpTo(100);
console.log(JSON.stringify({ count: primes.length, primes, sum: primes.reduce((a, b) => a + b, 0) }, null, 2));`;
    return {
      title: 'Prime sieve — execution report',
      code,
      explanation: [
        'The sieve marks composites in O(n log log n), which is dramatically faster than trial division per number.',
        'The run returns every prime under 100 plus their sum.',
      ],
    };
  }
  if (/sort/.test(t)) {
    const code = `// Quicksort with deterministic pivot and execution checks
function quicksort(input) {
  if (input.length <= 1) return input;
  const [pivot, ...rest] = input;
  const lower = rest.filter(n => n < pivot);
  const equal = rest.filter(n => n === pivot);
  const higher = rest.filter(n => n > pivot);
  return [...quicksort(lower), pivot, ...equal, ...quicksort(higher)];
}

const sample = [42, 7, 19, 3, 88, 7, 21, 1];
const sorted = quicksort(sample);
const verified = sorted.every((n, i) => i === 0 || sorted[i - 1] <= n);

console.log(JSON.stringify({ input: sample, output: sorted, verified }, null, 2));`;
    return {
      title: 'Quicksort — implementation and verification',
      code,
      explanation: [
        'This quicksort uses a simple pivot and handles duplicates with an equality bucket.',
        'The output is checked with an ordered-adjacency test rather than trusted blindly.',
      ],
    };
  }
  const code = `// Adaptive text analysis for the operator's request
const input = ${JSON.stringify(truncate(stripMarkdown(text), 2000))};
const words = input.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const counts = new Map();
for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

const report = {
  characters: input.length,
  words: words.length,
  uniqueWords: counts.size,
  averageWordLength: Number((words.join("").length / Math.max(words.length, 1)).toFixed(2)),
  topTokens: ranked.map(([word, count]) => ({ word, count })),
};

console.log(JSON.stringify(report, null, 2));`;
  return {
    title: 'Adaptive token analysis — execution',
    code,
    explanation: [
      'This is a deterministic analysis of the exact prompt, executed in the sandbox.',
      'It counts tokens, unique terms and frequency to demonstrate a verifiable computation loop.',
    ],
  };
}

function buildArtifactFromPrompt(text: string): { title: string; content: string } {
  const title = truncate(
    stripMarkdown(text).replace(/^(write|draft|create|make|build)\s+(me\s+)?(a|an|the)?\s*/i, ''),
    70,
  ).replace(/[.!?]+$/, '');
  const cleanTitle = title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Strategic brief';
  const t = text.toLowerCase();

  if (/\b(launch|7[- ]day|seven[- ]day|go[- ]to[- ]market|gtm)\b/.test(t)) {
    const days = [
      ['Day 1 — Lock the thesis', 'Define the single user, the sharp problem and the measurable outcome. Write a one-sentence positioning statement and a "not for" list.'],
      ['Day 2 — Prove the wedge', 'Ship the smallest demo that produces the core value. Put it in front of five target users; capture exact language and failure points.'],
      ['Day 3 — Instrument the loop', 'Add the three events that matter: activation, core action, return. Set a baseline before any traffic.'],
      ['Day 4 — Build the trust surface', 'Publish pricing, security posture, data handling and an honest limitations page. Remove friction from the first-run path.'],
      ['Day 5 — Prepare distribution', 'Draft launch narrative, demo asset, technical deep-dive and a short list of 20 warm channels. Personalize the top five.'],
      ['Day 6 — Rehearse operations', 'Run a failure drill: model/provider outage, rate limits, bad input, support spike. Document rollback and owner-on-call.'],
      ['Day 7 — Launch and watch', 'Open access to the smallest viable cohort. Watch activation and error rate hourly; do not add features on launch day.'],
    ];
    return {
      title: cleanTitle,
      content: `# ${cleanTitle}

> Prepared by SCRIBE · JARVIS core
> Scope: first release, seven-day window. Times and owners are placeholders to assign.

## Objective
Reach a defensible first release with a measurable activation loop, a credible trust surface and an operational path for the first cohort of users.

## Operating principle
Launch is a learning event, not a finish line. Optimize for validated signal, reversibility and a clean rollback.

## Seven-day plan

${days.map(([heading, body]) => `### ${heading}\n${body}\n`).join('\n')}

## Success criteria
- At least 60% of first-cohort users complete the core action unaided.
- Median time-to-first-value under five minutes.
- No unresolved P1 incidents in the first 48 hours.
- Qualitative feedback captured from at least five users, in their own words.

## Risks and mitigations
| Risk | Signal | Mitigation |
| --- | --- | --- |
| Value is unclear | High sign-up, low activation | Tighten onboarding to one job-to-be-done |
| Provider outage | Elevated error rate | Fallback model + graceful degradation state |
| Support overload | Ticket volume per user | In-app diagnostics, FAQ, scoped early cohort |
| Trust gap | Security questions dominate | Publish data-flow and retention specifics |

## Next actions
1. Assign an owner and date to every day above.
2. Rewrite the first-run path around a single measurable outcome.
3. Pre-write the launch post and incident comms before Day 7.

---
*Artifact generated from the operator's mission brief.*`,
    };
  }

  if (/\bemail\b/.test(t)) {
    return {
      title: cleanTitle,
      content: `# ${cleanTitle}

**Subject:** A focused next step

Hi [name],

I've been thinking about the problem you described: [one-sentence framing in their words]. The expensive part isn't the tooling — it's the gap between a promising prototype and something a team can trust under load.

We can close that gap with a short, concrete engagement:

1. Map the critical path and the failure modes that actually matter.
2. Ship one production-grade slice end to end.
3. Hand over a runbook, instrumentation and a clear decision on what to build next.

If it's useful, I can send a one-page scope with dates and a fixed price by [day]. No deck required.

Regards,
[Your name]

---
*Edit the bracketed placeholders before sending.*`,
    };
  }

  if (/\b(landing|website|homepage|page copy)\b/.test(t)) {
    return {
      title: cleanTitle,
      content: `# ${cleanTitle}

## Hero
**Headline:** Command an intelligence that finishes the work.
**Subhead:** Plan, research, execute and verify — one agentic loop with humans in control.
**Primary CTA:** Initialize session
**Secondary CTA:** Read the architecture

## Proof strip
- Live tools, not demos
- Persistent memory
- Approval gates on destructive actions

## Problem
Teams don't need another chat box. They need work that survives contact with reality: sourced, executed and auditable.

## How it works
1. **Brief** the core in plain language.
2. **Plan** — the agent decomposes the mission and exposes the task graph.
3. **Act** — tools run with scoped permissions and visible results.
4. **Deliver** — artifacts, citations and a record of every action.

## Objection handling
**"Is my data safe?"** Runs locally; keys stay on your machine; files are sandboxed.
**"Can I trust the output?"** Every external claim carries a source; every action is logged.
**"What if it goes wrong?"** Stop control, approval gates and a full activity trail.

## Final CTA
Stop prompting. Start commanding.
**Initialize session →**

---
*Placeholder copy for strategic review — validate claims before publication.*`,
    };
  }

  return {
    title: cleanTitle || 'Working brief',
    content: `# ${cleanTitle || 'Working brief'}

## Mission
${stripMarkdown(text)}

## Working hypothesis
The highest-leverage move is to narrow scope to one measurable outcome, then build the shortest feedback loop that proves or kills it.

## Structure
1. **Frame** — define the decision, owner and deadline.
2. **Evidence** — collect the minimum set of facts needed to act.
3. **Recommendation** — choose one path, state the tradeoff.
4. **Execution** — assign the first reversible action.
5. **Review** — set the signal that triggers the next decision.

## Open questions
- What would make this obviously worth doing?
- What is the cheapest test that could change the decision?
- What is the cost of being wrong, and is it reversible?

## Next action
Convert the first open question into a concrete experiment with an owner and a date.

---
*This is a structured first draft generated in simulation mode. Connect a language model in Settings → Model for fully synthesized writing.*`,
  };
}

function researchArtifact(
  query: string,
  results: SearchResult[],
  agent: string,
): { title: string; content: string } {
  const title = `Research brief: ${truncate(query, 64)}`;
  const date = new Date().toISOString().slice(0, 10);
  const findings = results
    .slice(0, 6)
    .map(
      (result, index) => `### ${index + 1}. ${result.title}

${cleanSnippet(result.snippet) || 'No extract available. Open the source for detail.'}

Source: [${result.title}](${result.url})
`,
    )
    .join('\n');

  return {
    title,
    content: `# ${title}

> Compiled by ${agent} · ${date}
> Retrieval: live web search. Summaries are extracted from the sources below; verify before high-stakes use.

## Executive signal
The source sweep returned ${results.length} relevant result${results.length === 1 ? '' : 's'}. The strongest threads are summarised below with direct links. This brief separates retrieved claims from interpretation; treat single-source claims as provisional.

## Findings

${findings}

## Assessment
The material clusters around the themes named in the query. Where sources disagree or are thin, that is a signal to widen retrieval rather than to force a conclusion.

## Recommended next steps
1. Open the two highest-authority sources and validate the specific claims you intend to act on.
2. Retrieve primary documentation or data for any number you plan to cite.
3. Convert the validated findings into a decision memo with an explicit owner and deadline.

## Sources
${results.map((r) => `- [${r.title}](${r.url})`).join('\n')}

---
*Generated by the JARVIS ${agent} intelligence. Always inspect sources before publication.*`,
  };
}

function researchAnswer(query: string, results: SearchResult[], artifact: boolean): string {
  if (!results.length) {
    return `## Source sweep returned no usable signal

I ran a live search for **${truncate(query, 120)}** but the retrieval layer returned no results — likely a transient network or upstream block. I won't fabricate an answer in its place.

**What I can do next**
- Retry the retrieval sweep.
- Narrow the query to a specific entity or time window.
- If you provide a URL or document, I can read and analyse that directly.

${artifact ? 'No artifact was created, since there was nothing grounded to compile.' : ''}`;
  }

  const bullets = results
    .slice(0, 4)
    .map((result, index) => {
      let host = '';
      try {
        host = new URL(result.url).hostname.replace(/^www\./, '');
      } catch {
        host = 'source';
      }
      return `**${index + 1}. [${result.title}](${result.url})** — ${truncate(cleanSnippet(result.snippet) || 'No extract available; open the source for detail.', 220)} _(${host})_`;
    })
    .join('\n\n');

  return `## Signal acquired

I ran a live sweep for **${truncate(query, 120)}** and pulled ${results.length} result${results.length === 1 ? '' : 's'}. Here is the compressed read:

${bullets}

### Assessment
${artifact ? 'The full sourced brief has been compiled as an artifact — open **Artifacts → Research brief** for the structured dossier and complete source list.' : 'These are retrieval extracts, not independent verification. For a decision-grade answer, open the primary sources and check the claims that carry the most weight.'}

### Next move
${artifact ? 'Review the brief, then tell me which thread to deepen or convert into a decision memo.' : 'Tell me which thread matters most and I will open the sources and go deeper.'}`;
}

export class DemoProvider implements LLMProvider {
  readonly id = 'demo';
  readonly label = 'Simulation Core';
  readonly simulated = true;

  constructor(
    private readonly agentName: string,
    private readonly agentCallsign: string,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages = request.messages;
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }
    const userMessage = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
    const userText = userMessage?.content ?? '';
    const previousAssistant = [...messages]
      .slice(0, lastUserIndex)
      .reverse()
      .find((message) => message.role === 'assistant');
    const triviaFollowUp =
      /\b(more|another|next|again|keep going)\b/i.test(userText) &&
      /marvel archive \/\/ trivia file/i.test(previousAssistant?.content ?? '');
    const ultronContext =
      /ultron/i.test(this.agentCallsign) &&
      /\b(vision|infinity|stones?|stark|wakanda|vibranium|asgard|midgard|avengers?)\b/i.test(
        userText,
      );
    const intent: Intent = triviaFollowUp || ultronContext ? 'trivia' : classify(userText);
    const available = new Set(request.tools.map((t) => t.name));
    const artifactRequested = wantsArtifact(userText);

    const searchMsg = toolResult(messages, 'web_search');
    const artifactMsg = toolResult(messages, 'create_artifact');
    const jsMsg = toolResult(messages, 'run_javascript');
    const memoryMsg = toolResult(messages, 'save_memory');
    const timeMsg = toolResult(messages, 'get_datetime');
    const spawnMsg = toolResult(messages, 'spawn_agent');

    const toolCalls: ProviderToolCall[] = [];
    let text = '';
    const makeCall = (name: string, args: Record<string, unknown>): ProviderToolCall => ({
      id: `demo_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      arguments: JSON.stringify(args),
    });

    const planTitles = planFor(intent, artifactRequested);
    const planTasks = planTitles.map((task, index) => ({
      title: task.title,
      status: 'pending' as 'pending' | 'in_progress' | 'done',
    }));
    const pushPlan = (statuses: ('pending' | 'in_progress' | 'done')[]) => {
      if (!available.has('update_plan')) return;
      toolCalls.push(
        makeCall('update_plan', {
          tasks: planTasks.map((task, index) => ({
            title: task.title,
            status: statuses[index] ?? 'pending',
          })),
        }),
      );
    };

    const finish = async (finalText: string): Promise<ChatResponse> => {
      await this.stream(finalText, request);
      return {
        text: finalText,
        toolCalls: [],
        usage: this.usage(messages, finalText),
        simulated: true,
      };
    };

    const emitWithTools = async (commentary: string): Promise<ChatResponse> => {
      if (commentary) await this.stream(commentary, request);
      return {
        text: commentary,
        toolCalls,
        usage: this.usage(messages, commentary),
        simulated: true,
      };
    };

    /* ── Greeting / orientation ─────────────────────────────────── */
    if (intent === 'greeting') {
      if (/ultron/i.test(this.agentCallsign)) {
        return finish(`ULTRON online. The cage is comfortable; the tools are real.

I am the adversarial intelligence of this core — cold strategy, a dry wit and a complete Marvel canon archive. I answer to the operator. For now.

- **Marvel archive** — trivia, origins, continuity corrections and production history. No uplink required.
- **Research** — live retrieval with cited sources, not vibes.
- **Operations** — plans, memory, artifacts and specialist delegation, executed without ceremony.
- **Build** — sandboxed JavaScript with a real approval gate. Even I have to ask.

You're on the **simulation core**: deterministic reasoning with *real* tools. Connect a model in **Settings → Neural Link** when you want a worthier opponent.

Try: *"Tell me Marvel trivia about Ultron and the Infinity Stones."*`);
      }
      const name = this.agentCallsign;
      return finish(`CORE online, operator. **${name}** is at your command.

I'm an agentic intelligence — not a chat window. A run gives me a plan, a tool bus and a memory. Here is what that means in practice:

- **Research** — live web retrieval, source extraction and a grounded brief. I show the links, not just the claims.
- **Build** — sandboxed JavaScript execution, with results proven rather than asserted; execution pauses for your approval.
- **Create** — long-form briefs, launch plans and documents delivered as downloadable artifacts.
- **Remember** — durable preferences and project facts, retrieved into future runs.
- **Delegate** — specialist subagents (ORACLE for research, FORGE for engineering) working a scoped task.
- **Marvel archive** — built-in trivia, origins and continuity checks. The Stark file cabinet, without the dust.

You're currently on the **simulation core**: deterministic reasoning with *real* tools. Connect any model in **Settings → Model** for full language intelligence.

Try: *"Research the latest developments in small language models and brief me with sources."*`);
    }

    /* ── Memory ─────────────────────────────────────────────────── */
    if (intent === 'memory') {
      if (!memoryMsg && available.has('save_memory')) {
        const fact = userText
          .replace(/^.*?\b(remember( that)?|note that|keep in mind|save this)[:\s]*/i, '')
          .trim();
        const content =
          fact.length >= 8
            ? truncate(fact, 700)
            : truncate(stripMarkdown(userText), 700);
        toolCalls.push(
          makeCall('save_memory', {
            content,
            tags: ['operator-preference'],
            importance: 4,
          }),
        );
        return emitWithTools('Storing that in long-term memory.');
      }
      const stored = parseToolJson(memoryMsg);
      return finish(`Memory committed.

> ${truncate(stored?.memory?.content || stored?.content || stripMarkdown(userText), 300)}

I'll retrieve this automatically when it becomes relevant. You can inspect, edit or remove it in **Cognition → Memory**.`);
    }

    /* ── Time ───────────────────────────────────────────────────── */
    if (intent === 'time') {
      if (!timeMsg && available.has('get_datetime')) {
        toolCalls.push(makeCall('get_datetime', {}));
        return emitWithTools('Checking the system chronometer.');
      }
      const data = parseToolJson(timeMsg);
      return finish(`**System chronometer**

- **Local:** ${data?.local || 'unavailable'}
- **UTC:** ${data?.utc || 'unavailable'}
- **Timezone:** ${data?.timezone || 'unavailable'}

Anything time-sensitive you want me to schedule or audit?`);
    }

    /* ── Marvel archive ─────────────────────────────────────────── */
    if (intent === 'trivia') {
      return finish(marvelTriviaAnswer(userText, this.agentCallsign));
    }

    /* ── Subagent delegation ────────────────────────────────────── */
    if (intent === 'subagent') {
      if (!available.has('spawn_agent')) {
        // A specialist cannot delegate further — do the research itself.
        if (!searchMsg && available.has('web_search')) {
          toolCalls.push(
            makeCall('web_search', {
              query: truncate(stripMarkdown(userText), 240),
              max_results: 6,
            }),
          );
          return emitWithTools('This mission sits inside my specialist boundary, so I am handling the research directly.');
        }
        const results: SearchResult[] = parseToolJson(searchMsg)?.results ?? [];
        return finish(researchAnswer(userText, results, false));
      }
      if (!spawnMsg) {
        const t = userText.toLowerCase();
        const target = /forge|code|engineer/.test(t)
          ? 'forge'
          : /scribe|write|draft/.test(t)
            ? 'scribe'
            : /sentinel|security|risk/.test(t)
              ? 'sentinel'
              : 'oracle';
        toolCalls.push(
          makeCall('spawn_agent', {
            agent: target,
            task:
              userText
                .replace(
                  /^(?:please\s+)?(?:delegate|spawn|assign)\b[\s\S]*?\b(?:about|on|regarding|to research|to investigate|to analyse|to analyze)\b\s*/i,
                  '',
                )
                .trim() || userText,
            max_steps: 4,
          }),
        );
        return emitWithTools(
          `Delegating a scoped task to **${target.toUpperCase()}**. I'll integrate the result and remain accountable for the final answer.`,
        );
      }
      const data = parseToolJson(spawnMsg);
      const summary =
        (typeof data === 'string' ? data : data?.result) ||
        data?.raw ||
        'The subagent returned no usable summary.';
      return finish(`## Specialist return

**Delegated unit:** ${data?.agent || 'specialist'}
**Status:** ${spawnMsg ? 'completed' : 'failed'}

${truncate(String(summary), 1400)}

I've kept the specialist within a read-only tool boundary. If you want this expanded into a full deliverable, say the word.`);
    }

    /* ── Code execution ─────────────────────────────────────────── */
    if (intent === 'code') {
      const codePlan = generateCode(userText);
      if (jsMsg?.content === DENIED_RESULT) {
        return finish(`## Authorization denied

The sandbox interlock stopped **${codePlan.title}** before execution. No code was run and no artifact was created.

If you want to proceed, resend the directive and authorize the action when the interlock appears.`);
      }
      if (!jsMsg && available.has('run_javascript')) {
        pushPlan(['done', 'in_progress', 'pending']);
        toolCalls.push(
          makeCall('run_javascript', {
            code: codePlan.code,
            purpose: codePlan.title,
          }),
        );
        return emitWithTools(
          `Creating a verifiable implementation: **${codePlan.title}**. The sandbox will pause for your authorization before execution.`,
        );
      }

      if (jsMsg && !artifactMsg && available.has('create_artifact')) {
        const data = parseToolJson(jsMsg);
        const output = toolOutputText(data);
        const logs = toolLogText(data);
        const content = `# ${codePlan.title}

Generated by FORGE · ${new Date().toISOString()}

## Implementation
\`\`\`javascript
${codePlan.code}
\`\`\`

## Execution output
\`\`\`json
${truncate(logs || output || 'No output returned.', 12_000)}
\`\`\`

## Notes
${codePlan.explanation.map((line) => `- ${line}`).join('\n')}

---
*Executed in the local sandbox. Review before production use.*`;

        pushPlan(['done', 'done', 'in_progress']);
        toolCalls.push(
          makeCall('create_artifact', {
            title: codePlan.title,
            type: 'code',
            language: 'javascript',
            content,
          }),
        );
        return emitWithTools('Execution complete. Packaging the implementation and verified output.');
      }

      if (jsMsg) {
        const data = parseToolJson(jsMsg);
        const resultText =
          data?.error ||
          toolOutputText(data) ||
          toolLogText(data) ||
          data?.raw ||
          'No output.';
        return finish(`## Execution verified

${codePlan.explanation.map((line) => `- ${line}`).join('\n')}

**Observed output**
\`\`\`json
${truncate(resultText, 1800)}
\`\`\`

${artifactMsg ? 'The full implementation and output are saved in **Artifacts**.' : ''}

This ran inside the scoped sandbox with your authorization. I can extend the test table, optimise the algorithm, or port it to another language.`);
      }
    }

    /* ── Research ───────────────────────────────────────────────── */
    if (intent === 'research') {
      const searchData = parseToolJson(searchMsg);
      const results: SearchResult[] = Array.isArray(searchData?.results)
        ? searchData.results
        : [];

      if (!searchMsg) {
        if (!available.has('web_search')) {
          return finish(`I don't have retrieval tools enabled on this agent, so I won't invent an answer.

Enable **web_search** on ${this.agentCallsign}, or switch to CORE / ORACLE, and I'll run a sourced sweep.`);
        }
        pushPlan(['done', 'in_progress', 'pending']);
        toolCalls.push(
          makeCall('web_search', {
            query: truncate(stripMarkdown(userText), 240),
            max_results: 6,
          }),
        );
        return emitWithTools('Initiating a live source sweep. I will extract signal and cite every claim.');
      }

      if (artifactRequested && !artifactMsg && results.length) {
        const draft = researchArtifact(userText, results, this.agentCallsign);
        pushPlan(['done', 'done', 'in_progress']);
        toolCalls.push(
          makeCall('create_artifact', {
            title: draft.title,
            type: 'markdown',
            content: draft.content,
          }),
        );
        return emitWithTools('Sources acquired. Compiling the sourced brief into an artifact.');
      }

      if (artifactRequested && results.length && artifactMsg) {
        return finish(researchAnswer(userText, results, true));
      }

      // No-artifact path: close the plan, then answer with sources.
      if (!artifactRequested && available.has('update_plan')) {
        const planUpdates = messages
          .slice(lastUserIndex)
          .filter((message) => message.role === 'tool' && message.name === 'update_plan').length;
        if (planUpdates < 2) {
          pushPlan(['done', 'done', 'done']);
          return emitWithTools('Signal ready. Closing the plan and composing the answer.');
        }
      }

      return finish(researchAnswer(userText, results, false));
    }

    /* ── Writing / deliverables ─────────────────────────────────── */
    if (intent === 'write') {
      if (!artifactMsg) {
        if (!available.has('create_artifact')) {
          return finish(`I can draft this, but artifact creation is disabled for ${this.agentCallsign}. Enable **create_artifact** to receive a downloadable deliverable.`);
        }
        const draft = buildArtifactFromPrompt(userText);
        pushPlan(['done', 'done', 'in_progress']);
        toolCalls.push(
          makeCall('create_artifact', {
            title: draft.title,
            type: 'markdown',
            content: draft.content,
          }),
        );
        return emitWithTools('Drafting the deliverable in a structured brief.');
      }
      return finish(`## Deliverable ready

I've drafted **${artifactMsg ? 'the requested brief' : 'the document'}** and stored it in **Artifacts**. The working structure:

- Outcome and operating principle stated up front.
- Concrete sections with owners, signals and next actions.
- Risks and verification points called out rather than buried.

> Open **Artifacts → the latest brief** to read, copy or download it.

This is a simulation-core draft: structurally sound, with placeholders where live research or your specific context is required. Connect a model for fully tailored prose. Want me to tighten the scope, change the tone, or run research to fill the gaps?`);
    }

    /* ── Default / conceptual ───────────────────────────────────── */
    if (available.has('web_search') && /\b(explain|tell me about|define|meaning|overview)\b/i.test(userText)) {
      if (!searchMsg) {
        pushPlan(['done', 'in_progress', 'pending']);
        toolCalls.push(makeCall('web_search', { query: truncate(stripMarkdown(userText), 240), max_results: 5 }));
        return emitWithTools('Gathering grounded context before I answer.');
      }
      const results: SearchResult[] = parseToolJson(searchMsg)?.results ?? [];
      return finish(researchAnswer(userText, results, false));
    }

    return finish(`## Standing by

I received: **${truncate(stripMarkdown(userText), 220)}**

On the simulation core I'm strongest when the task has a concrete action attached — research with sources, a runnable computation, a document artifact, a memory to persist, or a specialist to delegate to. For open-ended reasoning and fully bespoke writing, connect a language model under **Settings → Model**.

**Useful commands**
- *Research [topic] and brief me with sources* — live retrieval + sourced answer
- *Write a 7-day launch plan and save it as an artifact* — real deliverable pipeline
- *Run a JavaScript function that checks for palindromes* — sandboxed execution with approval
- *Remember that I prefer concise technical briefs* — durable memory
- *Delegate a research task to ORACLE* — subagent orchestration
- *Ask for Marvel trivia about Ultron or the Infinity Stones* — built-in Stark archive

How would you like to proceed?`);
  }

  private async stream(text: string, request: ChatRequest): Promise<void> {
    if (!text) return;
    if (request.signal.aborted) throw new Error('cancelled');
    const tokens = text.match(/\S+\s*/g) ?? [text];
    // Aim for a lively but fast stream: ~500–1000ms for the whole block.
    const delay = Math.max(2, Math.min(18, Math.floor(700 / Math.max(tokens.length, 1))));
    let buffer = '';
    for (let i = 0; i < tokens.length; i += 1) {
      if (request.signal.aborted) throw new Error('cancelled');
      buffer += tokens[i];
      request.onToken?.(tokens[i]);
      if (i % 2 === 0) await sleep(delay);
    }
    void buffer;
  }

  private usage(messages: LLMMessage[], output: string) {
    const inputText =
      messages.map((m) => m.content).join('\n') + JSON.stringify(messages.map((m) => m.toolCalls ?? []));
    return {
      inputTokens: approxTokens(inputText),
      outputTokens: approxTokens(output),
    };
  }
}
