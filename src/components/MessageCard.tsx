import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Copy,
  FileText,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import type { AgentProfile, ArtifactMeta, ChatMessage } from '../../shared/types';
import { useAppStore } from '../store/useAppStore';
import { usePrefsStore } from '../store/prefsStore';
import { useSpeech } from '../hooks/useSpeech';
import { accentHex } from '../lib/accents';
import { cn, formatTokens } from '../lib/utils';
import { AgentSigil } from './AgentSigil';
import { Markdown } from './Markdown';
import { ToolRow } from './ToolTrace';

function messageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface MessageCardProps {
  message: ChatMessage;
  agent?: AgentProfile;
  artifacts: ArtifactMeta[];
}

export function MessageCard({ message, agent, artifacts }: MessageCardProps) {
  const openArtifact = useAppStore((state) => state.openArtifact);
  const tts = usePrefsStore((state) => state.tts);
  const speech = useSpeech();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const isAssistant = message.role === 'assistant';
  const messageArtifacts = artifacts.filter((artifact) =>
    message.artifacts?.includes(artifact.id),
  );
  const speaking = speech.speakingId === message.id;

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = () => {
    void navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    });
  };

  const toggleSpeech = () => {
    if (speaking) {
      speech.cancel();
      return;
    }
    speech.speak(message.content, message.id);
  };

  return (
    <article className={cn('message', isAssistant ? 'message--assistant' : 'message--user')}>
      <div className="message__gutter">
        {isAssistant ? (
          <span
            className="message__avatar"
            style={{ color: accentHex(agent?.accent) }}
          >
            <AgentSigil icon={agent?.icon} size={34} />
          </span>
        ) : (
          <span className="message__avatar message__avatar--operator">OP</span>
        )}
        <span className="message__thread" aria-hidden="true" />
      </div>

      <div className="message__main">
        <header className="message__head">
          <span className="message__author">
            {isAssistant
              ? message.agentName ?? agent?.name ?? 'J.A.R.V.I.S.'
              : 'Operator'}
          </span>
          <span className="message__callsign">
            {isAssistant
              ? message.agentCallsign ?? agent?.callsign ?? 'CORE'
              : 'AUTHORITY'}
          </span>
          {message.simulated && <span className="badge badge--sim">SIM</span>}
          <time className="message__time" dateTime={new Date(message.createdAt).toISOString()}>
            {messageTime(message.createdAt)}
          </time>
        </header>

        <div className="message__body">
          <Markdown content={message.content} />
        </div>

        {isAssistant && message.toolCalls && message.toolCalls.length > 0 && (
          <details className="tool-disclosure">
            <summary>
              <Wrench size={12} />
              <span>Tool activity</span>
              <span className="tool-disclosure__count">{message.toolCalls.length}</span>
              <ChevronDown size={13} className="tool-disclosure__chev" />
            </summary>
            <div className="tool-disclosure__body">
              {message.toolCalls.map((call) => (
                <ToolRow key={call.id} call={call} compact />
              ))}
            </div>
          </details>
        )}

        {messageArtifacts.length > 0 && (
          <div className="message__artifacts">
            {messageArtifacts.map((artifact) => (
              <button
                key={artifact.id}
                className="artifact-chip"
                onClick={() => openArtifact(artifact.id)}
              >
                <FileText size={14} />
                <span>
                  <strong>{artifact.title}</strong>
                  <em>
                    {artifact.type}
                    {artifact.language ? ` · ${artifact.language}` : ''}
                  </em>
                </span>
                <span className="artifact-chip__open">OPEN</span>
              </button>
            ))}
          </div>
        )}

        {isAssistant && (
          <footer className="message__foot">
            <button className="text-btn" onClick={copy}>
              <Copy size={11} /> {copied ? 'Copied' : 'Copy'}
            </button>
            {speech.supported && (
              <button
                className={cn('text-btn', speaking && 'is-active')}
                onClick={toggleSpeech}
                disabled={!tts}
                title={tts ? 'Read aloud' : 'Enable voice output in settings'}
              >
                {speaking ? <VolumeX size={11} /> : <Volume2 size={11} />}
                {speaking ? 'Stop' : 'Speak'}
              </button>
            )}
            {message.usage && (
              <span className="message__usage">
                {formatTokens(message.usage.inputTokens + message.usage.outputTokens)} tokens
                {message.latencyMs ? ` · ${(message.latencyMs / 1000).toFixed(1)}s` : ''}
              </span>
            )}
            {message.runId && (
              <span className="message__run mono">
                RUN {message.runId.slice(-6).toUpperCase()}
              </span>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}
