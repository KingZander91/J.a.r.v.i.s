import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function uid(prefix = ''): string {
  const raw = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}${raw.slice(0, prefix ? 16 : 20)}`;
}

export function now(): number {
  return Date.now();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function approxTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (full, name) => ENTITIES[name.toLowerCase()] ?? full);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function atomicWrite(file: string, contents: string, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contents, { encoding: 'utf8', mode });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, mode);
  } catch {
    /* non-fatal */
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function shortJson(value: unknown, max = 1200): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return truncate(text ?? '', max);
  } catch {
    return String(value);
  }
}

export function titleFromInput(input: string, max = 58): string {
  const clean = stripMarkdown(input).replace(/^["'`]+|["'`]+$/g, '');
  if (!clean) return 'Untitled session';
  const firstLine = clean.split(/\n/)[0] ?? clean;
  const shortened =
    firstLine.length > max
      ? `${firstLine.slice(0, max - 1).split(' ').slice(0, -1).join(' ') || firstLine.slice(0, max - 1)}…`
      : firstLine;
  return shortened.charAt(0).toUpperCase() + shortened.slice(1);
}

export function isPrivateAddress(ip: string): boolean {
  if (!ip) return true;
  // Strip IPv6-mapped IPv4 prefix.
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (normalized.includes(':')) {
    const lower = normalized.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    return false;
  }
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export function groupByDate<T extends { updatedAt: number }>(items: T[]): {
  today: T[];
  yesterday: T[];
  older: T[];
} {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayStart = startOfDay.getTime();
  const yesterdayStart = todayStart - 86_400_000;
  return {
    today: items.filter((i) => i.updatedAt >= todayStart),
    yesterday: items.filter(
      (i) => i.updatedAt < todayStart && i.updatedAt >= yesterdayStart,
    ),
    older: items.filter((i) => i.updatedAt < yesterdayStart),
  };
}
