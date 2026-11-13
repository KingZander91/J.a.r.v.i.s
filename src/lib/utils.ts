import type { AgentProfile, SessionSummary } from '../../shared/types';

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function uid(prefix = 'ui'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatClock(date = new Date()): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(date: Date | number): string {
  const value = typeof date === 'number' ? new Date(date) : date;
  return value.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelative(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 45_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(timestamp);
}

export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function truncateMiddle(value: string, max = 48): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function groupSessions(sessions: SessionSummary[]): Array<{
  label: string;
  items: SessionSummary[];
}> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayStart = startOfDay.getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 7 * 86_400_000;

  const groups: Array<{ label: string; items: SessionSummary[] }> = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Archive', items: [] },
  ];

  for (const session of sessions) {
    if (session.updatedAt >= todayStart) groups[0].items.push(session);
    else if (session.updatedAt >= yesterdayStart) groups[1].items.push(session);
    else if (session.updatedAt >= weekStart) groups[2].items.push(session);
    else groups[3].items.push(session);
  }
  return groups.filter((group) => group.items.length > 0);
}

export function agentFor(
  agents: AgentProfile[],
  id: string | undefined,
): AgentProfile | undefined {
  return agents.find((agent) => agent.id === id) ?? agents.find((agent) => agent.id === 'core');
}

export function agentAccent(agent: AgentProfile | undefined): string {
  switch (agent?.accent) {
    case 'cyan':
      return '#5fe6ff';
    case 'amber':
      return '#ffc464';
    case 'violet':
      return '#b18cff';
    case 'rose':
      return '#ff7d9b';
    default:
      return 'var(--accent)';
  }
}

export function stripMarkdownForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(name: string, fallback = 'jarvis-artifact'): string {
  const clean = name
    .replace(/[^a-z0-9\-_ ]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return clean || fallback;
}

export function artifactExtension(type: string, language?: string): string {
  if (type === 'markdown') return 'md';
  if (type === 'html') return 'html';
  if (type === 'json') return 'json';
  if (type === 'code') {
    const map: Record<string, string> = {
      javascript: 'js',
      typescript: 'ts',
      tsx: 'tsx',
      jsx: 'jsx',
      python: 'py',
      rust: 'rs',
      go: 'go',
      css: 'css',
      sql: 'sql',
      bash: 'sh',
      shell: 'sh',
      json: 'json',
      html: 'html',
    };
    return map[(language ?? '').toLowerCase()] ?? 'txt';
  }
  return 'txt';
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
