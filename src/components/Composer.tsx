import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Mic,
  MicOff,
  Paperclip,
  Square,
  Volume2,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { usePrefsStore } from '../store/prefsStore';
import { useDictation } from '../hooks/useDictation';
import { accentHex } from '../lib/accents';
import { AgentSigil } from './AgentSigil';

export function Composer() {
  const session = useAppStore((state) => state.session);
  const agents = useAppStore((state) => state.agents);
  const settings = useAppStore((state) => state.settings);
  const run = useAppStore((state) => state.run);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const cancelRun = useAppStore((state) => state.cancelRun);
  const openSettings = useAppStore((state) => state.openSettings);
  const openAgentModal = useAppStore((state) => state.openAgentModal);
  const addToast = useAppStore((state) => state.addToast);
  const tts = usePrefsStore((state) => state.tts);
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const baseRef = useRef('');
  const agent = agents.find((candidate) => candidate.id === session?.agentId);
  const simulated = settings.model.provider === 'demo';
  const dictation = useDictation((text) => {
    const base = baseRef.current.trim();
    setInput(base ? `${base} ${text}` : text);
  });

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.min(220, Math.max(58, element.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    setInput('');
    const element = textareaRef.current;
    if (element) element.style.height = '58px';
  }, [session?.id]);

  const submit = () => {
    const clean = input.trim();
    if (!clean) return;
    if (run) {
      addToast('warn', 'Core is executing. Stop the run before sending another directive.');
      return;
    }
    setInput('');
    if (dictation.listening) dictation.stop();
    void sendMessage(clean);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const startDictation = () => {
    if (!dictation.supported) return;
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    baseRef.current = input;
    dictation.start();
  };

  return (
    <div className="composer-dock">
      <div className="composer-shell">
        {run && (
          <div className="composer-run-notice">
            <span className="live-pulse" />
            <span>
              Core executing · {run.detail ?? 'working through the objective'} · stop to redirect
            </span>
            <button className="btn btn--ghost btn--small" onClick={() => void cancelRun()}>
              <Square size={10} fill="currentColor" /> Stop run
            </button>
          </div>
        )}
        <div className={`composer ${input.trim() ? 'has-content' : ''}`}>
          <div className="composer__topline">
            <span className="eyebrow">Directive</span>
            <span className="composer__mode">
              <span className={`status-dot ${simulated ? 'is-sim' : 'is-live'}`} />
              {simulated ? 'Simulation' : 'Live'} · {settings.model.model}
            </span>
          </div>
          <textarea
            ref={textareaRef}
            className="composer__input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              dictation.listening
                ? 'Listening… speak your directive'
                : run
                  ? 'Type while the core works, or stop the run to send.'
                  : 'Send a directive. The core plans, uses tools and reports back…'
            }
            rows={1}
            maxLength={20_000}
            aria-label="Message the core"
          />
          <div className="composer__bar">
            <div className="composer__tools">
              <button
                className="composer-chip"
                onClick={() => agent && openAgentModal(agent.id)}
                title="Configure current agent"
              >
                <span className="composer-chip__sigil" style={{ color: accentHex(agent?.accent) }}>
                  <AgentSigil icon={agent?.icon} size={17} orbit={false} />
                </span>
                <span>{agent?.callsign ?? 'CORE'}</span>
              </button>
              <button
                className="composer-chip composer-chip--muted"
                onClick={openSettings}
                title="Model settings"
              >
                <span className={`status-dot ${simulated ? 'is-sim' : 'is-live'}`} />
                <span>{simulated ? 'SIM CORE' : 'LIVE'}</span>
              </button>
              {dictation.supported && (
                <button
                  className={`composer-chip composer-chip--icon ${dictation.listening ? 'is-listening' : ''}`}
                  onClick={startDictation}
                  title={dictation.listening ? 'Stop dictation' : 'Dictate a directive'}
                  aria-label={dictation.listening ? 'Stop dictation' : 'Dictate a directive'}
                >
                  {dictation.listening ? <MicOff size={13} /> : <Mic size={13} />}
                  <span>{dictation.listening ? 'LISTENING' : 'VOICE'}</span>
                </button>
              )}
              <button
                className="composer-chip composer-chip--icon composer-chip--faint"
                onClick={openSettings}
                title={tts ? 'Voice output is enabled' : 'Enable voice output in settings'}
                aria-label="Voice settings"
              >
                <Volume2 size={13} />
              </button>
              <span className="composer__hint-keys">
                <kbd>↵</kbd> send <span>/</span> <kbd>⇧↵</kbd> newline
              </span>
            </div>
            <div className="composer__actions">
              <button
                className="composer__attach"
                onClick={() => addToast('info', 'File context arrives in the next core build. Workspace tools are live today.')}
                title="Attach context"
                aria-label="Attach context"
              >
                <Paperclip size={14} />
              </button>
              {run ? (
                <button className="send-btn send-btn--stop" onClick={() => void cancelRun()} aria-label="Stop run">
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-btn"
                  onClick={submit}
                  disabled={!input.trim()}
                  aria-label="Send directive"
                >
                  <ArrowUp size={16} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="composer-foot">
          <span>
            <span className="status-dot is-live" /> Secure local channel
          </span>
          <span>
            {settings.yoloMode ? 'YOLO mode · gates bypassed' : 'Approval gates armed'}
          </span>
        </div>
      </div>
    </div>
  );
}
