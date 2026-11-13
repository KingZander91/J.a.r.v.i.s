import type { ReactNode } from 'react';
import type { AgentIcon } from '../../shared/types';
import { cn } from '../lib/utils';

interface AgentSigilProps {
  icon?: AgentIcon;
  size?: number;
  className?: string;
  orbit?: boolean;
}

const SHAPES: Record<AgentIcon, ReactNode> = {
  core: (
    <>
      <circle cx="24" cy="24" r="13" opacity="0.9" />
      <path d="M24 13.5 33 29.5H15Z" opacity="0.72" />
      <circle cx="24" cy="24" r="3" fill="currentColor" stroke="none" />
      <path d="M24 4v4M24 40v4M4 24h4M40 24h4" opacity="0.8" />
    </>
  ),
  oracle: (
    <>
      <path d="M5 24c5.6-8 12-12 19-12s13.4 4 19 12c-5.6 8-12 12-19 12S10.6 32 5 24Z" />
      <circle cx="24" cy="24" r="7" opacity="0.7" />
      <circle cx="24" cy="24" r="2.4" fill="currentColor" stroke="none" />
      <path d="M24 4v4M24 40v4M4 24h4M40 24h4" opacity="0.55" />
    </>
  ),
  forge: (
    <>
      <path d="M24 5 40 14.5v19L24 43 8 33.5v-19Z" />
      <path d="M16 18h16M16 24h11M16 30h16" opacity="0.62" />
      <path d="m30.5 21.5 4.5 4.5-4.5 4.5" opacity="0.9" />
    </>
  ),
  scribe: (
    <>
      <path d="M13 6.5h15l7 7v28H13Z" />
      <path d="M28 6.5v8h7" opacity="0.6" />
      <path d="M18.5 23h11M18.5 28h11M18.5 33h6.5" opacity="0.62" />
      <path d="M37 13c-8 2.2-13.4 7.3-16.4 14.6L18 35l7.4-2.6C32.7 29.4 36.8 23.2 37 13Z" opacity="0.95" />
    </>
  ),
  sentinel: (
    <>
      <path d="M24 4.5 39.5 11v11.2c0 9-6 16.1-15.5 21.3C14.5 38.3 8.5 31.2 8.5 22.2V11Z" />
      <circle cx="24" cy="21" r="3.2" opacity="0.85" />
      <path d="M24 24v8" opacity="0.85" />
    </>
  ),
  ultron: (
    <>
      <path d="M24 5.5 40 14v19.5L24 42.5 8 33.5V14Z" />
      <path d="M14.5 19.5h7l2.4 3.4-2.4 3.4h-7l-2.4-3.4Z" opacity="0.95" />
      <path d="M26.5 19.5h7l2.4 3.4-2.4 3.4h-7l-2.4-3.4Z" opacity="0.95" />
      <path d="M17 31.5h14M10.5 17 5 12.5M37.5 17 43 12.5" opacity="0.7" />
      <circle cx="24" cy="26.3" r="1.1" fill="currentColor" stroke="none" opacity="0.8" />
    </>
  ),
  nexus: (
    <>
      <circle cx="24" cy="24" r="4.2" opacity="0.95" />
      <circle cx="24" cy="7" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="40.5" cy="15.5" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="40.5" cy="32.5" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="24" cy="41" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="32.5" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="15.5" r="2.1" fill="currentColor" stroke="none" />
      <path d="M24 9.5v10M37.5 17.5 27.5 22M37.5 30.5 27.5 26M24 38.5v-10M10.5 30.5 20.5 26M10.5 17.5 20.5 22" opacity="0.55" />
    </>
  ),
  custom: (
    <>
      <path d="M24 4.5 43.5 24 24 43.5 4.5 24Z" opacity="0.9" />
      <circle cx="24" cy="24" r="7" opacity="0.75" />
      <ellipse cx="24" cy="24" rx="17" ry="5.5" transform="rotate(-32 24 24)" opacity="0.45" />
    </>
  ),
};

export function AgentSigil({ icon = 'core', size = 34, className, orbit = true }: AgentSigilProps) {
  return (
    <span
      className={cn('sigil', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.35">
        {orbit && (
          <circle
            className="sigil__orbit"
            cx="24"
            cy="24"
            r="22"
            strokeDasharray="1.5 5.5"
            opacity="0.42"
          />
        )}
        {SHAPES[icon] ?? SHAPES.custom}
      </svg>
    </span>
  );
}

export function JarvisMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('jarvis-mark', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" width="100%" height="100%" fill="none" stroke="currentColor">
        <circle cx="32" cy="32" r="29" strokeWidth="1" opacity="0.35" strokeDasharray="2 6" className="jarvis-mark__orbit" />
        <circle cx="32" cy="32" r="22" strokeWidth="1.1" opacity="0.75" />
        <circle cx="32" cy="32" r="17" strokeWidth="0.7" opacity="0.3" />
        <path d="M32 15 46.5 40h-29Z" strokeWidth="1.4" fill="rgba(var(--accent-rgb), 0.08)" />
        <path d="M32 26.5 37.5 36h-11Z" strokeWidth="1" opacity="0.8" fill="currentColor" fillOpacity="0.18" />
        <circle cx="32" cy="32" r="2.2" fill="currentColor" stroke="none" />
        <path d="M32 3v5M32 56v5M3 32h5M56 32h5" strokeWidth="1.2" opacity="0.85" />
      </svg>
    </span>
  );
}
