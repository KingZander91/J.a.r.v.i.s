import vm from 'node:vm';
import util from 'node:util';
import { withTimeout } from '../util';
import type { ToolContext } from './registry';

/* ── Calculator ─────────────────────────────────────────────────── */

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

class ExpressionParser {
  private pos = 0;
  constructor(private readonly input: string) {}

  parse(): number {
    const value = this.expression();
    this.skipSpace();
    if (this.pos < this.input.length) {
      throw new Error(`Unexpected token "${this.input.slice(this.pos)}" at position ${this.pos}.`);
    }
    if (!Number.isFinite(value)) {
      throw new Error('Result is not a finite number.');
    }
    return value;
  }

  private skipSpace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) this.pos += 1;
  }

  private expression(): number {
    let value = this.term();
    while (true) {
      this.skipSpace();
      const char = this.input[this.pos];
      if (char === '+') {
        this.pos += 1;
        value += this.term();
      } else if (char === '-') {
        this.pos += 1;
        value -= this.term();
      } else {
        return value;
      }
    }
  }

  private term(): number {
    let value = this.power();
    while (true) {
      this.skipSpace();
      const char = this.input[this.pos];
      if (char === '*') {
        this.pos += 1;
        value *= this.power();
      } else if (char === '/') {
        this.pos += 1;
        const divisor = this.power();
        if (divisor === 0) throw new Error('Division by zero.');
        value /= divisor;
      } else if (char === '%') {
        this.pos += 1;
        const divisor = this.power();
        if (divisor === 0) throw new Error('Modulo by zero.');
        value %= divisor;
      } else {
        return value;
      }
    }
  }

  private power(): number {
    const base = this.unary();
    this.skipSpace();
    if (this.input[this.pos] === '^') {
      this.pos += 1;
      return Math.pow(base, this.power());
    }
    return base;
  }

  private unary(): number {
    this.skipSpace();
    if (this.input[this.pos] === '+') {
      this.pos += 1;
      return this.unary();
    }
    if (this.input[this.pos] === '-') {
      this.pos += 1;
      return -this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    this.skipSpace();
    if (this.input[this.pos] === '(') {
      this.pos += 1;
      const value = this.expression();
      this.skipSpace();
      if (this.input[this.pos] !== ')') throw new Error('Missing closing parenthesis.');
      this.pos += 1;
      return value;
    }
    const numberMatch = this.input.slice(this.pos).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (numberMatch) {
      this.pos += numberMatch[0].length;
      return Number(numberMatch[0]);
    }
    const identMatch = this.input.slice(this.pos).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (!identMatch) {
      throw new Error(`Expected a number, function or parenthesis at position ${this.pos}.`);
    }
    const name = identMatch[0].toLowerCase();
    this.pos += identMatch[0].length;
    this.skipSpace();
    if (this.input[this.pos] === '(') {
      const fn = FUNCTIONS[name];
      if (!fn) throw new Error(`Unknown function "${name}".`);
      this.pos += 1;
      const args: number[] = [];
      this.skipSpace();
      if (this.input[this.pos] !== ')') {
        args.push(this.expression());
        while (true) {
          this.skipSpace();
          if (this.input[this.pos] === ',') {
            this.pos += 1;
            args.push(this.expression());
          } else {
            break;
          }
        }
      }
      this.skipSpace();
      if (this.input[this.pos] !== ')') throw new Error('Missing closing parenthesis in function call.');
      this.pos += 1;
      return fn(...args);
    }
    if (name in CONSTANTS) return CONSTANTS[name];
    throw new Error(`Unknown identifier "${name}".`);
  }
}

export function calculate(expression: string): number {
  const clean = expression.replace(/,/g, ',').trim();
  if (!clean) throw new Error('Expression is empty.');
  if (clean.length > 400) throw new Error('Expression is too long (max 400 characters).');
  if (/[^0-9a-zA-Z_+\-*/%^().,\s]/.test(clean)) {
    throw new Error('Expression contains unsupported characters.');
  }
  return new ExpressionParser(clean).parse();
}

/* ── JavaScript sandbox ─────────────────────────────────────────── */

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try {
    return util.inspect(value, { depth: 4, maxArrayLength: 60, breakLength: 100 });
  } catch {
    return String(value);
  }
}

export async function runJavaScript(
  code: string,
  ctx: ToolContext,
): Promise<{ output: string; logs: string[] }> {
  if (!code.trim()) throw new Error('No code supplied.');
  if (code.length > 24_000) throw new Error('Code exceeds the 24,000 character limit.');
  if (ctx.signal.aborted) throw new Error('Execution cancelled.');

  const logs: string[] = [];
  const capture = (...args: unknown[]) => {
    const line = args.map(stringifyValue).join(' ');
    logs.push(line.length > 4000 ? `${line.slice(0, 4000)}…` : line);
    if (logs.length > 200) logs.shift();
  };

  const sandbox = {
    console: {
      log: capture,
      info: capture,
      warn: capture,
      error: capture,
      debug: capture,
      table: capture,
    },
  };

  const context = vm.createContext(sandbox, {
    name: 'jarvis-sandbox',
    codeGeneration: { strings: false, wasm: false },
  });

  const started = Date.now();
  const script = new vm.Script(
    `(async () => {\n"use strict";\n${code}\n})()`,
    { filename: 'jarvis-sandbox.js' },
  );

  let result: unknown;
  try {
    const evaluation = script.runInContext(context, { timeout: 5000 }) as Promise<unknown>;
    result = await withTimeout(
      Promise.resolve(evaluation),
      8000,
      'Execution timed out after 8 seconds.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logText = logs.length ? `\n\nConsole output:\n${logs.join('\n')}` : '';
    throw new Error(`Execution failed: ${message}${logText}`);
  }

  const output = result === undefined ? '' : stringifyValue(result);
  return {
    output: output.length > 12_000 ? `${output.slice(0, 12_000)}…` : output,
    logs,
  };
}

/* ── Tool handlers ──────────────────────────────────────────────── */

export async function calculatorTool(
  args: Record<string, unknown>,
): Promise<{ content: string; summary: string }> {
  const expression = String(args.expression ?? '');
  const value = calculate(expression);
  return {
    content: JSON.stringify({ expression, result: value }, null, 2),
    summary: `${expression} = ${value}`,
  };
}

export async function javascriptTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: string; summary: string }> {
  const code = String(args.code ?? '');
  const purpose = String(args.purpose ?? 'computation').slice(0, 160);
  const started = Date.now();
  const { output, logs } = await runJavaScript(code, ctx);
  const durationMs = Date.now() - started;
  return {
    content: JSON.stringify(
      {
        ok: true,
        purpose,
        result: output,
        logs,
        durationMs,
        note: 'Sandboxed JavaScript. No network, filesystem or Node globals were available.',
      },
      null,
      2,
    ),
    summary: `${purpose} · ${durationMs}ms`,
  };
}
