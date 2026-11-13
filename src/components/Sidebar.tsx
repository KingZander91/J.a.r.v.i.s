import { useMemo, useState } from 'react';
import {
  ChevronDown,
  Filter,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatRelative, groupSessions } from '../lib/utils';
import { AgentSigil } from './AgentSigil';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function Sidebar() {
  const agents = useAppStore((state) => state.agents);
  const sessions = useAppStore((state) => state.sessions);
  const session = useAppStore((state) => state.session);
  const view = useAppStore((state) => state.view);
  const run = useAppStore((state) => state.run);
  const activeAgentId = useAppStore((state) => state.activeAgentId);
  const settings = useAppStore((state) => state.settings);
  const server = useAppStore((state) => state.server);
  const ui = useAppStore((state) => state.ui);
  const setView = useAppStore((state) => state.setView);
  const setActiveAgentId = useAppStore((state) => state.setActiveAgentId);
  const setUI = useAppStore((state) => state.setUI);
  const openSession = useAppStore((state) => state.openSession);
  const newSession = useAppStore((state) => state.newSession);
  const openAgentModal = useAppStore((state) => state.openAgentModal);
  const openSettings = useAppStore((state) => state.openSettings);
  const togglePinSession = useAppStore((state) => state.togglePinSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const addToast = useAppStore((state) => state.addToast);
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sessions;
    return sessions.filter(
      (item) =>
        item.title.toLowerCase().includes(term) ||
        (item.preview ?? '').toLowerCase().includes(term),
    );
  }, [sessions, query]);

  const groups = useMemo(() => groupSessions(filtered), [filtered]);

  const selectedAgentId =
    view === 'session' && session ? session.agentId : activeAgentId;

  const handleAgent = (agentId: string) => {
    if (run) {
      addToast('warn', 'Stop the active run before switching agents.');
      return;
    }
    setActiveAgentId(agentId);
    setView('core');
    if (window.innerWidth < 960) setUI({ sidebarOpen: false });
  };

  const handleNewSession = (agentId?: string) => {
    if (run) {
      addToast('warn', 'Stop the active run before starting a new channel.');
      return;
    }
    void newSession(agentId);
    if (window.innerWidth < 960) setUI({ sidebarOpen: false });
  };

  const handleDelete = (id: string, title: string) => {
    askConfirm({
      title: 'Erase channel?',
      message: `“${title}” and its transcript will be permanently removed. Artifacts and memories are retained.`,
      confirmLabel: 'Erase channel',
      danger: true,
      onConfirm: () => deleteSession(id),
    });
  };

  return (
    <aside className={`sidebar ${ui.sidebarOpen ? 'is-open' : 'is-closed'}`}>
      <div className="sidebar__head">
        <div className="sidebar__head-title">
          <span className="eyebrow">Agent deck</span>
          <span className="sidebar__count">{agents.length}</span>
        </div>
        <div className="sidebar__head-actions">
          <button
            className="icon-btn"
            onClick={() => openAgentModal()}
            title="Create agent profile"
            aria-label="Create agent profile"
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-btn sidebar__collapse"
            onClick={() => setUI({ sidebarOpen: false })}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="agent-deck">
        {agents.map((agent) => {
          const active = selectedAgentId === agent.id;
          const toolCount = agent.tools.includes('*') ? 'ALL' : String(agent.tools.length);
          return (
            <div key={agent.id} className={`agent-row ${active ? 'is-active' : ''}`}>
              <button className="agent-row__main" onClick={() => handleAgent(agent.id)}>
                <AgentSigil icon={agent.icon} size={30} />
                <span className="agent-row__text">
                  <span className="agent-row__name">{agent.name}</span>
                  <span className="agent-row__call">{agent.callsign}</span>
                </span>
                <span className="agent-row__count">{toolCount}</span>
              </button>
              <button
                className="agent-row__new"
                onClick={() => handleNewSession(agent.id)}
                title={`New channel with ${agent.name}`}
                aria-label={`New channel with ${agent.name}`}
              >
                <Plus size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        className="sidebar__new"
        onClick={() => handleNewSession(activeAgentId)}
        disabled={Boolean(run)}
      >
        <span className="sidebar__new-icon">
          <Plus size={14} />
        </span>
        <span>New channel</span>
        <span className="sidebar__new-hint">{settings.model.provider === 'demo' ? 'SIM' : 'LIVE'}</span>
      </button>

      <div className="sidebar__channels-head">
        <div className="sidebar__head-title">
          <span className="eyebrow">Channels</span>
          <span className="sidebar__count">{sessions.length}</span>
        </div>
        <button
          className={`icon-btn ${filterOpen ? 'is-active' : ''}`}
          onClick={() => {
            setFilterOpen((open) => !open);
            setQuery('');
          }}
          title="Filter channels"
          aria-label="Filter channels"
        >
          <Filter size={13} />
        </button>
      </div>

      {filterOpen && (
        <div className="sidebar__search">
          <Search size={13} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search transmissions…"
            aria-label="Search channels"
          />
          <button
            onClick={() => {
              setQuery('');
              setFilterOpen(false);
            }}
            aria-label="Close search"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="sidebar__sessions">
        {groups.length === 0 && (
          <div className="sidebar__empty">
            <span className="eyebrow">No channels found</span>
            <p>{query ? 'Adjust your filter or open a new channel.' : 'Your first mission begins on the Core.'}</p>
            {!query && (
              <button className="btn btn--ghost btn--small" onClick={() => setView('core')}>
                Open core
              </button>
            )}
          </div>
        )}

        {groups.map((group) => (
          <div className="session-group" key={group.label}>
            <div className="session-group__label">
              <ChevronDown size={10} />
              <span>{group.label}</span>
              <span className="session-group__line" />
            </div>
            {group.items.map((item) => {
              const agent = agents.find((candidate) => candidate.id === item.agentId);
              const active = view === 'session' && session?.id === item.id;
              return (
                <div key={item.id} className={`session-row ${active ? 'is-active' : ''}`}>
                  <button className="session-row__main" onClick={() => void openSession(item.id)}>
                    <span className="session-row__mark" />
                    <span className="session-row__body">
                      <span className="session-row__title">{item.title}</span>
                      <span className="session-row__meta">
                        {agent?.callsign ?? 'CORE'} · {formatRelative(item.updatedAt)}
                      </span>
                    </span>
                    {item.pinned && <Pin size={10} className="session-row__pin" />}
                  </button>
                  <div className="session-row__actions">
                    <button
                      onClick={() => void togglePinSession(item.id)}
                      title={item.pinned ? 'Unpin channel' : 'Pin channel'}
                      aria-label={item.pinned ? 'Unpin channel' : 'Pin channel'}
                    >
                      {item.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.title)}
                      title="Delete channel"
                      aria-label="Delete channel"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="sidebar__foot">
        <div className="sidebar__link-status">
          <span className={`status-dot ${settings.model.provider === 'demo' ? 'is-sim' : 'is-live'}`} />
          <div>
            <strong>{settings.model.provider === 'demo' ? 'SIMULATION CORE' : 'NEURAL LINK'}</strong>
            <span>
              {settings.providerStatus.label} · {settings.model.model}
            </span>
          </div>
          <button className="icon-btn" onClick={openSettings} aria-label="Configure model">
            <Settings2 size={14} />
          </button>
        </div>
        <div className="sidebar__legal">
          <span>LOCAL-FIRST</span>
          <span>v{settings.version || '2.0.0'}</span>
          <span>UP {formatUptime(server.uptime)}</span>
        </div>
      </div>
    </aside>
  );
}
