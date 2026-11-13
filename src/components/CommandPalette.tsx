import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Boxes,
  BrainCircuit,
  CornerDownLeft,
  Cpu,
  Database,
  Download,
  LayoutGrid,
  MessageSquare,
  Palette,
  PanelRightOpen,
  Plus,
  Search,
  Settings2,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ACCENT_LIST, accentHex } from '../lib/accents';
import { useAppStore } from '../store/useAppStore';
import { usePrefsStore } from '../store/prefsStore';
import { formatRelative } from '../lib/utils';
import { AgentSigil } from './AgentSigil';

interface Command {
  id: string;
  section: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  action: () => void;
}

export function CommandPalette() {
  const ui = useAppStore((state) => state.ui);
  const agents = useAppStore((state) => state.agents);
  const sessions = useAppStore((state) => state.sessions);
  const session = useAppStore((state) => state.session);
  const activeAgentId = useAppStore((state) => state.activeAgentId);
  const run = useAppStore((state) => state.run);
  const closePalette = useAppStore((state) => state.closePalette);
  const setView = useAppStore((state) => state.setView);
  const setActiveAgentId = useAppStore((state) => state.setActiveAgentId);
  const setCogOpen = useAppStore((state) => state.setCogOpen);
  const setCogTab = useAppStore((state) => state.setCogTab);
  const newSession = useAppStore((state) => state.newSession);
  const openSession = useAppStore((state) => state.openSession);
  const openSettings = useAppStore((state) => state.openSettings);
  const openAgentModal = useAppStore((state) => state.openAgentModal);
  const exportSession = useAppStore((state) => state.exportSession);
  const cancelRun = useAppStore((state) => state.cancelRun);
  const addToast = useAppStore((state) => state.addToast);
  const theme = usePrefsStore((state) => state.theme);
  const setTheme = usePrefsStore((state) => state.setTheme);
  const sound = usePrefsStore((state) => state.sound);
  const setSound = usePrefsStore((state) => state.setSound);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeAnd = (action: () => void) => {
    closePalette();
    action();
  };

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    const agent = agents.find((item) => item.id === activeAgentId) ?? agents[0];

    list.push({
      id: 'core',
      section: 'Navigate',
      label: 'Go to command core',
      hint: 'Reactor, mission brief and agent deck',
      icon: <LayoutGrid size={16} />,
      action: () => closeAnd(() => setView('core')),
    });
    list.push({
      id: 'new-channel',
      section: 'Navigate',
      label: 'Open a new channel',
      hint: `Start with ${agent?.name ?? 'the core'}`,
      icon: <Plus size={16} />,
      action: () => closeAnd(() => void newSession(activeAgentId)),
    });

    if (session) {
      list.push({
        id: 'channel',
        section: 'Navigate',
        label: 'Return to active channel',
        hint: session.title,
        icon: <MessageSquare size={16} />,
        action: () => closeAnd(() => setView('session')),
      });
      list.push({
        id: 'cognition',
        section: 'Navigate',
        label: 'Toggle cognition panel',
        hint: ui.cogOpen ? 'Close analysis deck' : 'Open plan, activity and memory',
        icon: <PanelRightOpen size={16} />,
        action: () =>
          closeAnd(() => {
            setCogOpen(!ui.cogOpen);
          }),
      });
      list.push({
        id: 'memory',
        section: 'Navigate',
        label: 'Open memory deck',
        hint: 'Durable facts and preferences',
        icon: <Database size={16} />,
        action: () =>
          closeAnd(() => {
            setCogOpen(true);
            setCogTab('memory');
          }),
      });
      list.push({
        id: 'artifacts',
        section: 'Navigate',
        label: 'Open artifact deck',
        hint: 'Generated briefs, code and files',
        icon: <Boxes size={16} />,
        action: () =>
          closeAnd(() => {
            setCogOpen(true);
            setCogTab('artifacts');
          }),
      });
      list.push({
        id: 'system',
        section: 'Navigate',
        label: 'Open system telemetry',
        hint: 'Model link, runtime and usage',
        icon: <Cpu size={16} />,
        action: () =>
          closeAnd(() => {
            setCogOpen(true);
            setCogTab('system');
          }),
      });
      list.push({
        id: 'export',
        section: 'Actions',
        label: 'Export channel as markdown',
        hint: 'Download the full transcript',
        icon: <Download size={16} />,
        action: () => closeAnd(() => exportSession()),
      });
    }

    list.push({
      id: 'settings',
      section: 'Actions',
      label: 'Open core configuration',
      hint: 'Model provider, behavior, interface',
      icon: <Settings2 size={16} />,
      action: () => closeAnd(() => openSettings()),
    });
    list.push({
      id: 'new-agent',
      section: 'Actions',
      label: 'Create a new intelligence',
      hint: 'Agent profile with custom tools',
      icon: <Bot size={16} />,
      action: () => closeAnd(() => openAgentModal()),
    });
    if (run) {
      list.push({
        id: 'stop-run',
        section: 'Actions',
        label: 'Stop the active run',
        hint: 'Transmit an abort signal to the core',
        icon: <Square size={16} />,
        action: () => closeAnd(() => void cancelRun()),
      });
    }
    list.push({
      id: 'sound',
      section: 'Interface',
      label: sound ? 'Mute interface sound' : 'Enable interface sound',
      hint: sound ? 'Currently on' : 'Currently off',
      icon: sound ? <Volume2 size={16} /> : <VolumeX size={16} />,
      action: () =>
        closeAnd(() => {
          setSound(!sound);
          addToast('info', sound ? 'Interface sound muted.' : 'Interface sound enabled.');
        }),
    });
    list.push({
      id: 'theme',
      section: 'Interface',
      label: 'Cycle reactor accent',
      hint: ACCENT_LIST.find((accent) => accent.id === theme)?.label,
      icon: <Palette size={16} />,
      action: () =>
        closeAnd(() => {
          const index = ACCENT_LIST.findIndex((accent) => accent.id === theme);
          const next = ACCENT_LIST[(index + 1) % ACCENT_LIST.length];
          setTheme(next.id);
          addToast('info', `Accent set to ${next.label}.`);
        }),
    });
    for (const accent of ACCENT_LIST) {
      if (accent.id === theme) continue;
      list.push({
        id: `theme-${accent.id}`,
        section: 'Interface',
        label: `Set accent: ${accent.label}`,
        icon: (
          <span
            className="palette-theme-dot"
            style={{ background: accent.hex }}
            aria-hidden="true"
          />
        ),
        keywords: 'theme color appearance reactor',
        action: () =>
          closeAnd(() => {
            setTheme(accent.id);
            addToast('info', `Accent set to ${accent.label}.`);
          }),
      });
    }

    for (const item of agents) {
      list.push({
        id: `agent-${item.id}`,
        section: 'Agents',
        label: `Select ${item.name}`,
        hint: `${item.callsign} · ${item.tools.includes('*') ? 'all tools' : `${item.tools.length} tools`}`,
        keywords: item.description,
        icon: (
          <span style={{ color: accentHex(item.accent) }}>
            <AgentSigil icon={item.icon} size={22} orbit={false} />
          </span>
        ),
        action: () =>
          closeAnd(() => {
            if (run) {
              addToast('warn', 'Stop the active run before switching agents.');
              return;
            }
            setActiveAgentId(item.id);
            setView('core');
          }),
      });
    }

    for (const item of sessions.slice(0, 12)) {
      const itemAgent = agents.find((candidate) => candidate.id === item.agentId);
      list.push({
        id: `session-${item.id}`,
        section: 'Channels',
        label: item.title,
        hint: `${itemAgent?.callsign ?? 'CORE'} · ${formatRelative(item.updatedAt)}`,
        keywords: item.preview,
        icon: (
          <span style={{ color: accentHex(itemAgent?.accent) }}>
            <AgentSigil icon={itemAgent?.icon} size={22} orbit={false} />
          </span>
        ),
        action: () => closeAnd(() => void openSession(item.id)),
      });
    }

    return list;
  }, [
    agents,
    activeAgentId,
    sessions,
    session,
    run,
    sound,
    theme,
    ui.cogOpen,
    addToast,
    cancelRun,
    closePalette,
    exportSession,
    newSession,
    openAgentModal,
    openSession,
    openSettings,
    setActiveAgentId,
    setCogOpen,
    setCogTab,
    setSound,
    setTheme,
    setView,
  ]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''} ${command.section}`
        .toLowerCase()
        .includes(term),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!ui.paletteOpen) return;
    setQuery('');
    setSelected(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [ui.paletteOpen]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!ui.paletteOpen) return null;

  const execute = (command: Command | undefined) => {
    if (!command) return;
    command.action();
  };

  return (
    <div
      className="overlay palette-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closePalette();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelected((value) => Math.min(filtered.length - 1, value + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected((value) => Math.max(0, value - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            execute(filtered[selected]);
          }
        }}
      >
        <div className="palette__search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands, agents, channels…"
            aria-label="Search commands"
            spellCheck={false}
          />
          <kbd>ESC</kbd>
        </div>

        <div className="palette__list">
          {filtered.length === 0 && (
            <div className="palette__empty">
              <BrainCircuit size={22} />
              <p>No match. Try “channel”, “memory”, “agent” or “settings”.</p>
            </div>
          )}
          {filtered.map((command, index) => {
            const showSection = index === 0 || filtered[index - 1].section !== command.section;
            const active = index === selected;
            return (
              <Fragment key={command.id}>
                {showSection && <div className="palette__section">{command.section}</div>}
                <button
                  ref={active ? selectedRef : undefined}
                  className={`palette__item ${active ? 'is-selected' : ''}`}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => execute(command)}
                >
                  <span className="palette__item-icon">{command.icon}</span>
                  <span className="palette__item-copy">
                    <span className="palette__item-label">{command.label}</span>
                    {command.hint && <span className="palette__item-hint">{command.hint}</span>}
                  </span>
                  {active && <CornerDownLeft size={13} className="palette__enter" />}
                </button>
              </Fragment>
            );
          })}
        </div>

        <footer className="palette__foot">
          <span>
            <ArrowUp size={10} />
            <ArrowDown size={10} /> navigate
          </span>
          <span>
            <CornerDownLeft size={10} /> execute
          </span>
          <span className="palette__foot-spacer" />
          <span className="mono">{filtered.length} commands</span>
        </footer>
      </div>
    </div>
  );
}
