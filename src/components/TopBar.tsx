import {
  Command,
  Menu,
  MessageSquarePlus,
  Plus,
  Settings2,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useNow } from '../hooks/useNow';
import { formatClock } from '../lib/utils';
import { JarvisMark } from './AgentSigil';
import { cn } from '../lib/utils';

export function TopBar() {
  const view = useAppStore((state) => state.view);
  const session = useAppStore((state) => state.session);
  const settings = useAppStore((state) => state.settings);
  const ui = useAppStore((state) => state.ui);
  const run = useAppStore((state) => state.run);
  const setView = useAppStore((state) => state.setView);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const openPalette = useAppStore((state) => state.openPalette);
  const openSettings = useAppStore((state) => state.openSettings);
  const newSession = useAppStore((state) => state.newSession);
  const now = useNow(1000);
  const simulated = settings.model.provider === 'demo';
  const busy = Boolean(run);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          className={cn('icon-btn topbar__menu', ui.sidebarOpen && 'is-active')}
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar (⌘B)"
        >
          <Menu size={17} />
        </button>
        <button
          className="brand"
          onClick={() => setView('core')}
          aria-label="JARVIS core"
        >
          <span className="brand__mark">
            <JarvisMark size={31} />
          </span>
          <span className="brand__copy">
            <span className="brand__name">J.A.R.V.I.S.</span>
            <span className="brand__sub">AGENTIC COMMAND CORE</span>
          </span>
        </button>

        <nav className="topbar__nav" aria-label="Primary">
          <button
            className={cn('nav-tab', view === 'core' && 'is-active')}
            onClick={() => setView('core')}
          >
            <span>Core</span>
          </button>
          <button
            className={cn('nav-tab', view === 'session' && 'is-active')}
            onClick={() => setView('session')}
            disabled={!session}
          >
            <span>Channel</span>
            {session && <span className="nav-tab__dot" />}
          </button>
        </nav>
      </div>

      <div className="topbar__right">
        <button
          className="status-chip"
          onClick={openSettings}
          title={settings.providerStatus.hint ?? 'Open model settings'}
        >
          <span className={cn('status-chip__dot', simulated ? 'is-sim' : 'is-live')} />
          <span className="status-chip__body">
            <strong>{simulated ? 'SIMULATION' : settings.providerStatus.configured ? 'LIVE MODEL' : 'KEY REQUIRED'}</strong>
            <em>{settings.providerStatus.label}</em>
          </span>
        </button>

        <div className="topbar__clock">
          <span className="topbar__clock-time">{formatClock(new Date(now))}</span>
          <span className="topbar__clock-zone">LOCAL</span>
        </div>

        <button className="palette-trigger" onClick={openPalette} title="Command palette (⌘K)">
          <Command size={14} />
          <span className="palette-trigger__label">Command</span>
          <kbd>⌘K</kbd>
        </button>

        <button
          className={cn('icon-btn icon-btn--framed', busy && 'is-busy')}
          onClick={() => newSession()}
          aria-label="New channel"
          title="New channel"
          disabled={busy}
        >
          {busy ? <Zap size={16} /> : <MessageSquarePlus size={16} />}
        </button>

        <button
          className="icon-btn icon-btn--framed"
          onClick={openSettings}
          aria-label="Open settings"
          title="Core settings"
        >
          <Settings2 size={16} />
        </button>

        <button
          className="operator-badge"
          onClick={openSettings}
          aria-label="Operator settings"
          title="Operator"
        >
          <span>OP</span>
          <span className="operator-badge__dot" />
        </button>
      </div>
    </header>
  );
}
