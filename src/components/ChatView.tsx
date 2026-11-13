import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  LayoutGrid,
  ListChecks,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { usePrefsStore } from '../store/prefsStore';
import { useSpeech } from '../hooks/useSpeech';
import { accentHex } from '../lib/accents';
import { suggestionsForAgent } from '../lib/prompts';
import { agentFor, cn } from '../lib/utils';
import { AgentSigil } from './AgentSigil';
import { Composer } from './Composer';
import { LiveRunCard } from './LiveRunCard';
import { MessageCard } from './MessageCard';

export function ChatView() {
  const session = useAppStore((state) => state.session);
  const sessionLoading = useAppStore((state) => state.sessionLoading);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const agents = useAppStore((state) => state.agents);
  const tools = useAppStore((state) => state.tools);
  const artifacts = useAppStore((state) => state.artifacts);
  const settings = useAppStore((state) => state.settings);
  const run = useAppStore((state) => state.run);
  const ui = useAppStore((state) => state.ui);
  const setView = useAppStore((state) => state.setView);
  const setCogOpen = useAppStore((state) => state.setCogOpen);
  const renameSession = useAppStore((state) => state.renameSession);
  const togglePinSession = useAppStore((state) => state.togglePinSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const exportSession = useAppStore((state) => state.exportSession);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const tts = usePrefsStore((state) => state.tts);
  const autoSpeak = usePrefsStore((state) => state.autoSpeak);
  const speech = useSpeech();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastSpokenRef = useRef<string | null>(null);
  const speechSessionRef = useRef<string | null>(null);

  const agent = session ? agentFor(agents, session.agentId) : undefined;
  const simulated = settings.model.provider === 'demo';
  const liveRun = run && session && run.sessionId === session.id ? run : null;
  const toolCount = agent?.tools.includes('*') ? tools.length : (agent?.tools.length ?? 0);
  const channelArtifacts = useMemo(
    () => (session ? artifacts.filter((artifact) => artifact.sessionId === session.id) : []),
    [artifacts, session],
  );
  const planDone = session?.plan.filter((task) => task.status === 'done').length ?? 0;
  const planTotal = session?.plan.length ?? 0;
  const busy = Boolean(run);

  useEffect(() => {
    setEditing(false);
    setTitleDraft(session?.title ?? '');
    stickRef.current = true;
    const element = scrollerRef.current;
    if (element) {
      window.requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
    }
  }, [session?.id]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [session?.messages.length, liveRun?.text.length, liveRun?.toolCalls.length, liveRun?.status]);

  useEffect(() => {
    if (!session) return;
    const lastAssistant = [...session.messages].reverse().find((message) => message.role === 'assistant');
    if (speechSessionRef.current !== session.id) {
      speechSessionRef.current = session.id;
      lastSpokenRef.current = lastAssistant?.id ?? null;
      return;
    }
    if (!lastAssistant || lastAssistant.id === lastSpokenRef.current) return;
    lastSpokenRef.current = lastAssistant.id;
    if (tts && autoSpeak && !run) speech.speak(lastAssistant.content, lastAssistant.id);
  }, [session, tts, autoSpeak, run, speech]);

  useEffect(() => {
    if (!session) return;
    return () => {
      speech.cancel();
    };
  }, [session?.id, speech.cancel]);

  const handleScroll = () => {
    const element = scrollerRef.current;
    if (!element) return;
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 180;
  };

  const commitTitle = () => {
    setEditing(false);
    if (!session) return;
    const clean = titleDraft.trim();
    if (clean && clean !== session.title) void renameSession(session.id, clean);
  };

  const handleDelete = () => {
    if (!session) return;
    askConfirm({
      title: 'Erase channel?',
      message: `“${session.title}” and its transcript will be permanently removed. Artifacts and memories are retained.`,
      confirmLabel: 'Erase channel',
      danger: true,
      onConfirm: () => deleteSession(session.id),
    });
  };

  if (!session) {
    return (
      <div className="channel-state">
        {sessionLoading ? (
          <>
            <Loader2 size={22} className="spin" />
            <span className="eyebrow">Opening encrypted channel</span>
          </>
        ) : (
          <>
            <LayoutGrid size={24} />
            <h2>No channel open</h2>
            <p>Return to the core and launch a mission to establish a secure thread.</p>
            <button className="btn btn--primary" onClick={() => setView('core')}>
              Return to core
            </button>
          </>
        )}
      </div>
    );
  }

  if (sessionLoading && session.id !== activeSessionId) {
    return (
      <div className="channel-state">
        <Loader2 size={22} className="spin" />
        <span className="eyebrow">Opening encrypted channel</span>
      </div>
    );
  }

  return (
    <div className="chat-view">
      <header className="chat-head">
        <div className="chat-head__left">
          <button
            className="icon-btn chat-head__back"
            onClick={() => setView('core')}
            title="Back to core"
            aria-label="Back to core"
            disabled={busy}
          >
            <LayoutGrid size={15} />
          </button>
          <span className="chat-head__sigil" style={{ color: accentHex(agent?.accent) }}>
            <AgentSigil icon={agent?.icon} size={42} />
          </span>
          <div className="chat-head__titles">
            <div className="eyebrow chat-head__eyebrow">
              Secure channel
              <span className="chat-head__id mono">
                {session.id.slice(-6).toUpperCase()}
              </span>
              {simulated && <span className="badge badge--sim">SIMULATION</span>}
            </div>
            <div className="chat-head__title-row">
              {editing ? (
                <input
                  className="chat-head__title-input"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitTitle();
                    if (event.key === 'Escape') {
                      setEditing(false);
                      setTitleDraft(session.title);
                    }
                  }}
                  autoFocus
                  maxLength={120}
                  aria-label="Channel title"
                />
              ) : (
                <h1
                  className="chat-head__title"
                  onDoubleClick={() => {
                    setEditing(true);
                    setTitleDraft(session.title);
                  }}
                >
                  {session.title}
                </h1>
              )}
              {!editing && (
                <button
                  className="chat-head__edit"
                  onClick={() => {
                    setEditing(true);
                    setTitleDraft(session.title);
                  }}
                  title="Rename channel"
                  aria-label="Rename channel"
                >
                  <Pencil size={11} />
                </button>
              )}
            </div>
            <div className="chat-head__meta">
              <span>{agent?.name ?? 'J.A.R.V.I.S.'}</span>
              <span className="dot-sep">·</span>
              <span>{agent?.callsign ?? 'CORE'}</span>
              <span className="dot-sep">·</span>
              <span>{session.messages.length} transmissions</span>
              <span className="dot-sep">·</span>
              <span>{channelArtifacts.length} artifacts</span>
            </div>
          </div>
        </div>

        <div className="chat-head__right">
          {planTotal > 0 && (
            <div
              className="chat-head__plan"
              title={`${planDone} of ${planTotal} plan tasks complete`}
            >
              <ListChecks size={13} />
              <span className="mono">
                {planDone}/{planTotal}
              </span>
              <span className="chat-head__plan-bar">
                <i style={{ width: `${planTotal ? (planDone / planTotal) * 100 : 0}%` }} />
              </span>
            </div>
          )}
          <button
            className="icon-btn icon-btn--framed"
            onClick={() => void togglePinSession(session.id)}
            title={session.pinned ? 'Unpin channel' : 'Pin channel'}
            aria-label={session.pinned ? 'Unpin channel' : 'Pin channel'}
          >
            {session.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button
            className="icon-btn icon-btn--framed chat-head__optional"
            onClick={exportSession}
            title="Export channel as markdown"
            aria-label="Export channel"
          >
            <Download size={15} />
          </button>
          <button
            className={cn('icon-btn icon-btn--framed', ui.cogOpen && 'is-active')}
            onClick={() => setCogOpen(!ui.cogOpen)}
            title="Toggle cognition panel"
            aria-label="Toggle cognition panel"
          >
            {ui.cogOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
          <button
            className="icon-btn icon-btn--framed chat-head__optional chat-head__delete"
            onClick={handleDelete}
            title="Delete channel"
            aria-label="Delete channel"
            disabled={busy}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollerRef} onScroll={handleScroll}>
        <div className="chat-stream">
          <section className="channel-intro">
            <div className="channel-intro__glow" aria-hidden="true" />
            <div className="channel-intro__main">
              <span className="channel-intro__sigil" style={{ color: accentHex(agent?.accent) }}>
                <AgentSigil icon={agent?.icon} size={48} />
              </span>
              <div className="channel-intro__copy">
                <div className="eyebrow">Encrypted local thread</div>
                <h2>{agent?.name ?? 'J.A.R.V.I.S.'} is online.</h2>
                <p>{agent?.description ?? 'General command intelligence.'}</p>
              </div>
            </div>
            <div className="channel-intro__metrics">
              <div>
                <span>Tools</span>
                <strong>{toolCount}</strong>
              </div>
              <div>
                <span>Runs</span>
                <strong>{session.runCount}</strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>{simulated ? 'SIM' : 'LIVE'}</strong>
              </div>
            </div>
            <div className="channel-intro__line">
              <span className="status-dot is-live" />
              <span>Memory linked</span>
              <span className="dot-sep">·</span>
              <span>{settings.yoloMode ? 'Approval gates bypassed' : 'Approval gates armed'}</span>
              <span className="dot-sep">·</span>
              <span>Artifacts retained automatically</span>
              <span className="channel-intro__line-spacer" />
              <ShieldCheck size={12} />
              <span>Local-first</span>
            </div>
          </section>

          {session.messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              agent={agents.find((candidate) => candidate.id === message.agentId) ?? agent}
              artifacts={channelArtifacts}
            />
          ))}

          {liveRun && <LiveRunCard run={liveRun} agent={agent} />}

          {session.messages.length === 0 && !liveRun && (
            <section className="channel-empty">
              <span className="channel-empty__pulse">
                <span />
              </span>
              <div className="eyebrow">Channel established</div>
              <h3>Awaiting objective</h3>
              <p>
                State a mission below. {agent?.name ?? 'The core'} will plan the work, call
                tools, delegate specialists and deliver inspectable artifacts.
              </p>
              <div className="channel-empty__grid">
                {suggestionsForAgent(session.agentId).map((suggestion, index) => (
                  <button
                    key={suggestion}
                    className="empty-directive"
                    onClick={() => void sendMessage(suggestion)}
                    disabled={busy}
                  >
                    <span className="empty-directive__index">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span>{suggestion}</span>
                    <Sparkles size={12} />
                  </button>
                ))}
              </div>
              <div className="channel-empty__hint">
                <Wrench size={12} />
                <span>{toolCount} tools available</span>
                <Check size={12} />
                <span>Simulation core works without an API key</span>
              </div>
            </section>
          )}

          <div className="chat-end" />
        </div>
      </div>

      <Composer />
    </div>
  );
}
