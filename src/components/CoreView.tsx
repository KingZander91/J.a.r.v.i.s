import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Cpu,
  Database,
  FileText,
  Globe2,
  History,
  Layers,
  Maximize2,
  Minimize2,
  Plus,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import type { AgentProfile } from '../../shared/types';
import { MARVEL_TRIVIA } from '../../shared/marvel';
import { useAppStore } from '../store/useAppStore';
import { usePrefsStore } from '../store/prefsStore';
import { accentHex } from '../lib/accents';
import { suggestionsForAgent } from '../lib/prompts';
import { cn, formatCount, formatDate, formatRelative, formatTokens } from '../lib/utils';
import { AgentSigil } from './AgentSigil';
import { Reactor } from './Reactor';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function CoreView() {
  const agents = useAppStore((state) => state.agents);
  const activeAgentId = useAppStore((state) => state.activeAgentId);
  const sessions = useAppStore((state) => state.sessions);
  const session = useAppStore((state) => state.session);
  const settings = useAppStore((state) => state.settings);
  const stats = useAppStore((state) => state.stats);
  const tools = useAppStore((state) => state.tools);
  const memories = useAppStore((state) => state.memories);
  const artifacts = useAppStore((state) => state.artifacts);
  const run = useAppStore((state) => state.run);
  const setActiveAgentId = useAppStore((state) => state.setActiveAgentId);
  const launchMission = useAppStore((state) => state.launchMission);
  const openSession = useAppStore((state) => state.openSession);
  const openAgentModal = useAppStore((state) => state.openAgentModal);
  const openSettings = useAppStore((state) => state.openSettings);
  const addToast = useAppStore((state) => state.addToast);
  const theme = usePrefsStore((state) => state.theme);
  const reduceMotion = usePrefsStore((state) => state.reduceMotion);
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [archiveIndex, setArchiveIndex] = useState(() =>
    Math.floor(Math.random() * MARVEL_TRIVIA.length),
  );
  const expanded = fullscreen || immersive;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setArchiveIndex((index) => (index + 1) % MARVEL_TRIVIA.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onChange = () => {
      const native = document.fullscreenElement === panelRef.current;
      setFullscreen(native);
      if (native) setImmersive(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!immersive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setImmersive(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [immersive]);

  const selectedAgent =
    agents.find((agent) => agent.id === activeAgentId) ??
    agents.find((agent) => agent.id === 'core') ??
    agents[0];

  const suggestions = suggestionsForAgent(selectedAgent?.id);
  const simulated = settings.model.provider === 'demo';

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const tool of tools) {
      map.set(tool.category, (map.get(tool.category) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tools]);

  const approvalCount = tools.filter((tool) => tool.requiresApproval).length;
  const totalTokens = stats.inputTokens + stats.outputTokens;

  const chooseAgent = (agent: AgentProfile) => {
    setActiveAgentId(agent.id);
    window.setTimeout(() => inputRef.current?.focus(), 40);
  };

  const launch = () => {
    const clean = prompt.trim();
    if (!clean || run) return;
    void launchMission(clean, selectedAgent?.id);
    setPrompt('');
  };

  const handleComposerKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      launch();
    }
  };

  const toggleFullscreen = async () => {
    const panel = panelRef.current;
    if (immersive) {
      setImmersive(false);
      return;
    }
    if (!panel) return;
    if (document.fullscreenElement === panel) {
      await document.exitFullscreen().catch(() => setFullscreen(false));
      return;
    }
    if (typeof panel.requestFullscreen !== 'function') {
      setImmersive(true);
      return;
    }
    const outcome = await Promise.race([
      panel.requestFullscreen().then(
        () => 'native' as const,
        () => 'blocked' as const,
      ),
      new Promise<'timeout'>((resolve) => {
        window.setTimeout(() => resolve('timeout'), 900);
      }),
    ]);
    if (document.fullscreenElement === panel) return;
    if (outcome !== 'native') {
      setImmersive(true);
      if (outcome === 'timeout') {
        addToast('info', 'In-app fullscreen engaged. Press Esc to exit.');
      }
    }
  };

  return (
    <div className="core-view">
      <header className="core-head">
        <div className="core-head__copy">
          <div className="eyebrow">Command core // {formatDate(Date.now())}</div>
          <h1 className="core-head__title">
            {greeting()}, <span>operator.</span>
          </h1>
          <p className="core-head__sub">
            {agents.length} intelligences online · {tools.length} tools under command · all
            systems nominal
          </p>
        </div>
        <div className="core-head__actions">
          {run && (
            <button
              className="btn btn--ghost btn--small core-live-chip"
              onClick={() => {
                if (session) void openSession(session.id);
              }}
            >
              <span className="live-pulse" />
              Live mission · {run.status.replace(/_/g, ' ')}
              <ArrowUpRight size={13} />
            </button>
          )}
          {!run && session && (
            <button
              className="btn btn--ghost btn--small"
              onClick={() => void openSession(session.id)}
            >
              <History size={13} /> Resume channel
            </button>
          )}
          <button className="btn btn--ghost btn--small" onClick={() => openAgentModal()}>
            <Plus size={13} /> New intelligence
          </button>
        </div>
      </header>

      <div className="archive-strip" role="status" aria-live="off" aria-label="Marvel archive trivia">
        <span className="archive-strip__label">
          <Sparkles size={11} /> Stark archive // Marvel file
        </span>
        <span key={archiveIndex} className="archive-strip__fact">
          <strong>{MARVEL_TRIVIA[archiveIndex].subject}</strong> —{' '}
          {MARVEL_TRIVIA[archiveIndex].fact}
        </span>
        <span className="archive-strip__index">
          {String(archiveIndex + 1).padStart(2, '0')}/
          {String(MARVEL_TRIVIA.length).padStart(2, '0')}
        </span>
      </div>

      <section className="core-grid">
        <div className="core-primary">
          <div
            className={cn('panel panel--framed reactor-panel', immersive && 'is-immersive')}
            ref={panelRef}
          >
            <div className="reactor-panel__head">
              <div className="reactor-panel__title">
                <Activity size={13} />
                <span>ARC REACTOR</span>
                <span className="reactor-panel__tag">SECTOR 07</span>
              </div>
              <div className="reactor-panel__right">
                <span className="reactor-panel__status">
                  <span className={`status-dot ${simulated ? 'is-sim' : 'is-live'}`} />
                  {simulated ? 'SIMULATION CORE' : 'LIVE NEURAL LINK'}
                </span>
                <button
                  className="reactor-panel__fs"
                  onClick={() => void toggleFullscreen()}
                  title={expanded ? 'Exit fullscreen (Esc)' : 'Fullscreen reactor'}
                  aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen reactor'}
                  aria-pressed={expanded}
                >
                  {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>
              </div>
            </div>
            <Reactor
              accent={theme}
              status={run?.status ?? 'idle'}
              runActive={Boolean(run)}
              reduceMotion={reduceMotion}
            />
            <div className="reactor-panel__foot">
              <div>
                <span className="eyebrow">Power draw</span>
                <strong>{run ? '87.4%' : '62.1%'}</strong>
              </div>
              <div>
                <span className="eyebrow">Lattice</span>
                <strong>{run ? 'Engaged' : 'Idle'}</strong>
              </div>
              <div>
                <span className="eyebrow">Uptime</span>
                <strong>99.998%</strong>
              </div>
              <div>
                <span className="eyebrow">Cores</span>
                <strong>12 / 12</strong>
              </div>
            </div>
          </div>

          <div className="stat-strip">
            <div className="stat-cell">
              <span className="eyebrow">Channels</span>
              <strong>{formatCount(sessions.length)}</strong>
              <em>encrypted threads</em>
            </div>
            <div className="stat-cell">
              <span className="eyebrow">Missions</span>
              <strong>{formatCount(stats.runs)}</strong>
              <em>agentic runs</em>
            </div>
            <div className="stat-cell">
              <span className="eyebrow">Memory</span>
              <strong>{formatCount(memories.length)}</strong>
              <em>durable cells</em>
            </div>
            <div className="stat-cell">
              <span className="eyebrow">Artifacts</span>
              <strong>{formatCount(artifacts.length)}</strong>
              <em>deliverables</em>
            </div>
            <div className="stat-cell">
              <span className="eyebrow">Tokens</span>
              <strong>{formatTokens(totalTokens)}</strong>
              <em>in / out</em>
            </div>
          </div>
        </div>

        <div className="panel panel--framed mission-panel">
          <div className="mission-panel__head">
            <div>
              <div className="eyebrow">Mission brief</div>
              <h2>Direct the core</h2>
            </div>
            <span className="mission-panel__index">01</span>
          </div>

          <div className="mission-agent">
            <span
              className="mission-agent__sigil"
              style={{ color: accentHex(selectedAgent?.accent) }}
            >
              <AgentSigil icon={selectedAgent?.icon} size={48} />
            </span>
            <div className="mission-agent__copy">
              <div className="mission-agent__name">{selectedAgent?.name ?? 'J.A.R.V.I.S.'}</div>
              <div className="mission-agent__callsign">
                {selectedAgent?.callsign ?? 'CORE'} · active intelligence
              </div>
              <p>{selectedAgent?.description}</p>
            </div>
          </div>

          <div className="agent-switch" role="group" aria-label="Select agent">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`agent-switch__btn ${selectedAgent?.id === agent.id ? 'is-active' : ''}`}
                style={{ color: accentHex(agent.accent) }}
                onClick={() => chooseAgent(agent)}
                title={agent.name}
                aria-label={`Use ${agent.name}`}
                aria-pressed={selectedAgent?.id === agent.id}
              >
                <AgentSigil icon={agent.icon} size={22} orbit={false} />
              </button>
            ))}
            <button
              className="agent-switch__btn agent-switch__add"
              onClick={() => openAgentModal()}
              title="Create intelligence"
              aria-label="Create intelligence"
            >
              <Plus size={13} />
            </button>
          </div>

          <label className="field mission-field">
            <span className="field__label">Objective</span>
            <textarea
              ref={inputRef}
              className="textarea mission-textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKey}
              rows={5}
              placeholder="State the objective. The core will plan, call tools and report back…"
              disabled={Boolean(run)}
            />
          </label>

          <div className="mission-suggestions">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                className="suggestion"
                onClick={() => {
                  setPrompt(suggestion);
                  inputRef.current?.focus();
                }}
                disabled={Boolean(run)}
              >
                <Sparkles size={11} />
                <span>{suggestion}</span>
              </button>
            ))}
          </div>

          <div className="mission-meta">
            <div className="mission-meta__row">
              <span>Neural link</span>
              <strong className={simulated ? 'is-sim' : 'is-live'}>
                {settings.providerStatus.label}
              </strong>
            </div>
            <div className="mission-meta__row">
              <span>Model</span>
              <strong className="mono">{settings.model.model}</strong>
            </div>
            <div className="mission-meta__row">
              <span>Authority</span>
              <strong>
                {settings.yoloMode ? 'YOLO / UNGATED' : `${approvalCount} tools gated`}
              </strong>
            </div>
          </div>

          <button
            className="btn btn--primary mission-launch"
            onClick={launch}
            disabled={!prompt.trim() || Boolean(run)}
          >
            {run ? (
              <>
                <Zap size={15} className="spin" /> Core executing
              </>
            ) : (
              <>
                Initiate mission <ArrowRight size={15} />
              </>
            )}
          </button>
          <div className="mission-shortcut">
            <kbd>⌘</kbd> + <kbd>↵</kbd> to launch · shift + ↵ for a new line
          </div>
        </div>
      </section>

      <section className="panel agent-deck-panel">
        <div className="section-head">
          <div>
            <div className="eyebrow">Specialist intelligences</div>
            <h2>Agent deck</h2>
          </div>
          <button className="btn btn--ghost btn--small" onClick={() => openAgentModal()}>
            <Plus size={13} /> Add profile
          </button>
        </div>
        <div className="agent-grid">
          {agents.map((agent, index) => {
            const count = agent.tools.includes('*') ? tools.length : agent.tools.length;
            return (
              <button
                key={agent.id}
                className={`agent-card ${selectedAgent?.id === agent.id ? 'is-active' : ''}`}
                style={{ '--agent-color': accentHex(agent.accent) } as React.CSSProperties}
                onClick={() => chooseAgent(agent)}
              >
                <span className="agent-card__glow" aria-hidden="true" />
                <span className="agent-card__top">
                  <span className="agent-card__sigil">
                    <AgentSigil icon={agent.icon} size={38} />
                  </span>
                  <span className="agent-card__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </span>
                <span className="agent-card__callsign">{agent.callsign}</span>
                <span className="agent-card__name">{agent.name}</span>
                <span className="agent-card__desc">{agent.description}</span>
                <span className="agent-card__foot">
                  <span>
                    <Wrench size={11} /> {count} tools
                  </span>
                  <ArrowUpRight size={14} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="core-lower">
        <section className="panel recent-panel">
          <div className="section-head">
            <div>
              <div className="eyebrow">Transmission archive</div>
              <h2>Recent channels</h2>
            </div>
            <span className="badge">{sessions.length} total</span>
          </div>
          <div className="recent-list">
            {sessions.length === 0 && (
              <div className="recent-empty">
                <Globe2 size={22} />
                <p>No channels yet. Send your first objective to open a secure thread.</p>
              </div>
            )}
            {sessions.slice(0, 5).map((item) => {
              const agent = agents.find((candidate) => candidate.id === item.agentId);
              return (
                <button
                  key={item.id}
                  className="recent-row"
                  onClick={() => void openSession(item.id)}
                >
                  <span
                    className="recent-row__sigil"
                    style={{ color: accentHex(agent?.accent) }}
                  >
                    <AgentSigil icon={agent?.icon} size={28} orbit={false} />
                  </span>
                  <span className="recent-row__body">
                    <span className="recent-row__title">{item.title}</span>
                    <span className="recent-row__meta">
                      {agent?.callsign ?? 'CORE'} · {item.messageCount} messages ·{' '}
                      {formatRelative(item.updatedAt)}
                    </span>
                  </span>
                  <ArrowUpRight size={14} className="recent-row__arrow" />
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel capability-panel">
          <div className="section-head">
            <div>
              <div className="eyebrow">Tool registry</div>
              <h2>Capabilities</h2>
            </div>
            <span className="badge">{tools.length} tools</span>
          </div>
          <div className="capability-list">
            {categories.map(([category, count]) => (
              <div className="capability-row" key={category}>
                <span className="capability-row__icon">
                  {category.toLowerCase().includes('web') || category.toLowerCase().includes('research') ? (
                    <Globe2 size={13} />
                  ) : category.toLowerCase().includes('memory') ? (
                    <Database size={13} />
                  ) : category.toLowerCase().includes('file') ? (
                    <FileText size={13} />
                  ) : (
                    <Wrench size={13} />
                  )}
                </span>
                <span className="capability-row__name">{category}</span>
                <span className="capability-row__count">{String(count).padStart(2, '0')}</span>
              </div>
            ))}
          </div>
          <div className="capability-foot">
            <div>
              <ShieldCheck size={13} />
              <span>{approvalCount} approval-gated</span>
            </div>
            <div>
              <Cpu size={13} />
              <span>{simulated ? 'simulation core' : 'live inference'}</span>
            </div>
            <button className="link-btn" onClick={openSettings}>
              Configure <ArrowUpRight size={12} />
            </button>
          </div>
        </section>
      </div>

      <footer className="core-footer">
        <div className="core-footer__left">
          <span className="status-dot is-live" />
          <span>SECURE LOCAL STORAGE</span>
          <span className="core-footer__sep" />
          <span>APPROVAL GATES</span>
          <span className="core-footer__sep" />
          <span>AGENT DELEGATION</span>
          <span className="core-footer__sep" />
          <span>SANDBOXED EXECUTION</span>
        </div>
        <div className="core-footer__right">
          <Boxes size={13} />
          <span>{stats.tools || tools.length} modules</span>
          <Layers size={13} />
          <span>{agents.length} agents</span>
        </div>
      </footer>
    </div>
  );
}
