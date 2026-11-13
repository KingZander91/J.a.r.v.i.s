import { useEffect, useState } from 'react';
import { ArrowRight, RotateCw, Terminal } from 'lucide-react';
import type { BootState } from '../lib/types';
import { JarvisMark } from './AgentSigil';

const BOOT_LINES = [
  'Initializing J.A.R.V.I.S. kernel',
  'Mounting neural lattice',
  'Linking tool registry',
  'Restoring memory index',
  'Calibrating reactor core',
  'Compiling Stark archive',
  'Auditing Ultron containment',
  'Verifying channel ciphers',
  'Loading agent deck',
  'Establishing secure uplink',
  'Core online',
];

interface BootScreenProps {
  state: BootState;
  error: string | null;
  onRetry: () => void;
  onDone: () => void;
}

export function BootScreen({ state, error, onRetry, onDone }: BootScreenProps) {
  const [revealed, setRevealed] = useState(1);

  useEffect(() => {
    if (revealed >= BOOT_LINES.length) return;
    const timer = window.setTimeout(
      () => setRevealed((value) => Math.min(BOOT_LINES.length, value + 1)),
      150 + Math.random() * 110,
    );
    return () => window.clearTimeout(timer);
  }, [revealed]);

  useEffect(() => {
    if (state !== 'ready' || revealed < BOOT_LINES.length) return;
    const timer = window.setTimeout(onDone, 550);
    return () => window.clearTimeout(timer);
  }, [state, revealed, onDone]);

  const progress =
    state === 'ready'
      ? Math.round((revealed / BOOT_LINES.length) * 100)
      : Math.min(84, Math.round((revealed / BOOT_LINES.length) * 84));
  const hosted =
    typeof window !== 'undefined' &&
    !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

  if (state === 'error') {
    return (
      <div className="boot boot--error">
        <div className="boot__grid" aria-hidden="true" />
        <div className="boot__error-card">
          <div className="boot__mark boot__mark--error">
            <JarvisMark size={74} />
          </div>
          <div className="eyebrow">Uplink failure</div>
          <h1 className="boot__error-title">Core unreachable</h1>
          <p className="boot__error-msg">{error ?? 'The command server did not respond.'}</p>
          <div className="boot__terminal">
            <Terminal size={14} />
            <code>{hosted ? 'GET /api/health' : 'npm run dev'}</code>
            <span>
              {hosted
                ? 'check the deployment function logs and environment variables'
                : 'starts the API on :8787 and the interface on :3000'}
            </span>
          </div>
          <button className="btn btn--primary" onClick={onRetry}>
            <RotateCw size={14} /> Retry uplink
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="boot">
      <div className="boot__grid" aria-hidden="true" />
      <div className="boot__inner">
        <div className="boot__visual">
          <div className="boot__ring boot__ring--outer" aria-hidden="true" />
          <div className="boot__ring boot__ring--mid" aria-hidden="true" />
          <div className="boot__ring boot__ring--inner" aria-hidden="true" />
          <div className="boot__mark">
            <JarvisMark size={82} />
          </div>
          <div className="boot__scan" aria-hidden="true" />
        </div>

        <div className="boot__copy">
          <div className="eyebrow">Just A Rather Very Intelligent System</div>
          <h1 className="boot__title">J.A.R.V.I.S.</h1>
          <div className="boot__sub">AGENTIC COMMAND CORE · MK IV</div>
        </div>

        <div className="boot__console" aria-live="polite">
          {BOOT_LINES.map((line, index) => {
            const isVisible = index < revealed;
            const isActive = index === revealed - 1 && state !== 'ready';
            return (
              <div
                key={line}
                className={`boot__line ${isVisible ? 'is-visible' : ''} ${isActive ? 'is-active' : ''}`}
              >
                <span className="boot__line-time">
                  {String(index * 0.14 + 0.12).padStart(5, '0')}
                </span>
                <span className="boot__line-text">{line}</span>
                <span className="boot__line-status">
                  {isVisible ? (index === BOOT_LINES.length - 1 ? 'ONLINE' : 'OK') : '—'}
                </span>
              </div>
            );
          })}
        </div>

        <div className="boot__progress">
          <div className="boot__bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="boot__progress-meta">
            <span>{progress}%</span>
            <span>SECURE LOCAL LINK</span>
          </div>
        </div>

        <div className="boot__hint">
          <ArrowRight size={12} />
          Keep this process running. The interface will initialize automatically.
        </div>
      </div>
    </div>
  );
}
