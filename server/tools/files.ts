import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR } from '../config';
import { truncate } from '../util';

const MAX_READ = 60_000;
const MAX_WRITE = 300_000;
const MAX_ENTRIES = 200;

function ensureRoot(): string {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  return WORKSPACE_DIR;
}

function resolveSafePath(input: string): { absolute: string; relative: string } {
  const root = ensureRoot();
  let raw = String(input ?? '').trim();
  if (!raw) raw = '.';
  if (path.isAbsolute(raw)) {
    throw new Error('Absolute paths are not allowed. Use paths relative to the workspace root.');
  }
  const normalized = path.normalize(raw);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    throw new Error('Path escapes the workspace root.');
  }
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error('Path escapes the workspace root.');
  }
  return {
    absolute,
    relative: path.relative(root, absolute) || '.',
  };
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 4096);
  return sample.includes(0);
}

interface Entry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

function walk(root: string, current: string, depth: number, results: Entry[]): void {
  if (results.length >= MAX_ENTRIES) return;
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    if (results.length >= MAX_ENTRIES) return;
    const full = path.join(current, entry.name);
    const relative = path.relative(root, full);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (entry.isDirectory()) {
      results.push({ path: relative, type: 'directory', modified: stat.mtime.toISOString() });
      if (depth > 0) walk(root, full, depth - 1, results);
    } else {
      results.push({
        path: relative,
        type: 'file',
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }
}

export async function workspaceList(
  args: Record<string, unknown>,
): Promise<{ content: string; summary: string }> {
  const { absolute, relative } = resolveSafePath(String(args.path ?? '.'));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new Error(`Path does not exist: ${relative}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${relative}`);
  }
  const depth = Math.min(4, Math.max(0, Number(args.depth ?? 2)));
  const entries: Entry[] = [];
  walk(WORKSPACE_DIR, absolute, depth, entries);
  return {
    content: JSON.stringify(
      {
        root: 'workspace',
        path: relative,
        count: entries.length,
        truncated: entries.length >= MAX_ENTRIES,
        entries,
      },
      null,
      2,
    ),
    summary: `${relative} · ${entries.length} entries`,
  };
}

export async function workspaceRead(
  args: Record<string, unknown>,
): Promise<{ content: string; summary: string }> {
  const { absolute, relative } = resolveSafePath(String(args.path ?? ''));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new Error(`File does not exist: ${relative}`);
  }
  if (stat.isDirectory()) throw new Error(`Path is a directory: ${relative}`);
  if (stat.size > MAX_READ * 8) {
    throw new Error(`File is too large (${stat.size} bytes). Maximum is ${MAX_READ * 8} bytes.`);
  }
  const buffer = fs.readFileSync(absolute);
  if (isProbablyBinary(buffer)) throw new Error('File appears to be binary and cannot be read as text.');
  const text = buffer.toString('utf8');
  const truncated = text.length > MAX_READ;
  return {
    content: JSON.stringify(
      {
        path: relative,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        truncated,
        content: truncated ? `${text.slice(0, MAX_READ)}…` : text,
      },
      null,
      2,
    ),
    summary: `${relative} · ${stat.size} bytes`,
  };
}

export async function workspaceWrite(
  args: Record<string, unknown>,
): Promise<{ content: string; summary: string }> {
  const { absolute, relative } = resolveSafePath(String(args.path ?? ''));
  const content = String(args.content ?? '');
  const append = Boolean(args.append);
  if (content.length > MAX_WRITE) {
    throw new Error(`Content exceeds the ${MAX_WRITE.toLocaleString()} character limit.`);
  }
  let previousSize: number | null = null;
  try {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) throw new Error(`Path is a directory: ${relative}`);
    if (!append) previousSize = stat.size;
  } catch (error) {
    if (error instanceof Error && error.message.includes('directory')) throw error;
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  if (append) {
    fs.appendFileSync(absolute, content, 'utf8');
  } else {
    fs.writeFileSync(absolute, content, 'utf8');
  }
  const stat = fs.statSync(absolute);
  return {
    content: JSON.stringify(
      {
        ok: true,
        path: relative,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
        newSize: stat.size,
        previousSize,
        mode: append ? 'append' : 'overwrite',
        note: 'Written inside the sandboxed workspace. Reference this file by its relative path.',
      },
      null,
      2,
    ),
    summary: `${append ? 'appended' : 'wrote'} ${relative} · ${stat.size} bytes`,
  };
}

export function workspaceSummary(): string {
  try {
    const entries = fs.readdirSync(WORKSPACE_DIR);
    return truncate(entries.join(', '), 200) || 'empty';
  } catch {
    return 'unavailable';
  }
}
