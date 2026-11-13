import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  FileText,
  Network,
  Square,
  Wrench,
  Zap,
} from 'lucide-react';
import type { AgentProfile } from '../../shared/types';
import { useAppStore } from '../store/useAppStore';
import { useNow } from '../hooks/useNow';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/types';
import { formatElapsed, formatTokens } from '../lib/utils';
import type { LiveRun } from '../lib/types';
import { Markdown } from './Markdown';
import { PlanList } from './PlanList';
import { ToolRow } from './ToolTrace';

interface LiveRunCardProps {
  run: LiveRun;
  agent?: AgentProfile;
}

export function LiveRunCard({ run, agent }: LiveRunCardProps) {
  const cancelRun = useAppStore((state) => state.cancelRun);
  const openArtifact = useAppStore((state) => state.openArtifact);
  const now = useNow(500);
  const active = !['completed', 'failed', 'cancelled', 'max_steps'].includes(run.status);
  const elapsed = formatElapsed(now - run.startedAt);
  const color = STATUS_COLORS[run.status];
  const plan = run.plan;
  const maxTools = 14;
  const tools = run.toolCalls.slice(-maxTools);
  const artifacts = run.artifacts;

  return (
    <article className="live-run" data-status={run.status} style={{ '--run-color': color } as React.CSSProperties}>
      <header className="live-run__head">
        <span className="live-run__beacon" aria-hidden="true">
          <span />
        </span>
        <div className="live-run__title">
          <div className="eyebrow">
            Live execution
            <span className="live-run__dot">·</span>
            {run.simulated ? 'SIMULATION' : run.model}
          </div>
          <div className="live-run__status">
            <span style={{ color }}>{STATUS_LABELS[run.status]}</span>
            {agent && <span className="live-run__agent">{agent.callsign}</span>}
          </div>
          <div className="live-run__detail">{run.detail ?? 'Working through the objective'}</div>
        </div>
        <div className="live-run__controls">
          <span className="live-run__elapsed mono">{elapsed}</span>
          {active && (
            <button className="btn btn--ghost btn--small live-run__stop" onClick={() => void cancelRun()}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          )}
        </div>
      </header>

      {run.approval && (
        <div className="live-run__gate">
          <AlertTriangle size={14} />
          <span>
            Authorization required for <strong>{run.approval.toolName.replace(/_/g, ' ')}</strong>
          </span>
        </div>
      )}

      {plan.length > 0 && <PlanList tasks={plan} compact />}

      {(run.text || active) && (
        <div className="live-run__stream">
          {run.text ? (
            <Markdown content={run.text} streaming={active} />
          ) : (
            <div className="live-run__waiting">
              <span className="thinking-line">
                <span />
                <span />
                <span />
              </span>
              <span>Core is reasoning</span>
            </div>
          )}
          {active && run.text && <span className="stream-caret" aria-hidden="true" />}
        </div>
      )}

      {tools.length > 0 && (
        <section className="live-run__section">
          <div className="live-run__section-head">
            <span>
              <Wrench size={12} /> Tool activity
            </span>
            <span className="mono">{run.toolCalls.length}</span>
          </div>
          <div className="live-run__trace">
            {tools.map((call) => (
              <ToolRow key={call.id} call={call} compact />
            ))}
          </div>
        </section>
      )}

      {run.subagents.length > 0 && (
        <section className="live-run__section">
          <div className="live-run__section-head">
            <span>
              <Network size={12} /> Delegation
            </span>
            <span className="mono">{run.subagents.length}</span>
          </div>
          <div className="subagent-list">
            {run.subagents.map((trace) => (
              <div className="subagent-row" key={trace.id} data-phase={trace.phase}>
                <span className="subagent-row__dot" />
                <div>
                  <div className="subagent-row__head">
                    <strong>{trace.agentName}</strong>
                    <span>{trace.phase === 'started' ? 'deployed' : 'reported'}</span>
                  </div>
                  <p>{trace.phase === 'finished' ? trace.result ?? trace.task : trace.task}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {run.notices.length > 0 && (
        <div className="live-run__notices">
          {run.notices.map((notice) => (
            <div className={`run-notice run-notice--${notice.level}`} key={notice.id}>
              <AlertTriangle size={12} />
              <span>{notice.text}</span>
            </div>
          ))}
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="live-run__artifacts">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              className="artifact-chip artifact-chip--small"
              onClick={() => openArtifact(artifact.id)}
            >
              <FileText size={13} />
              <span>
                <strong>{artifact.title}</strong>
                <em>{artifact.type}</em>
              </span>
              <ArrowUpRight size={12} />
            </button>
          ))}
        </div>
      )}

      <footer className="live-run__foot">
        <span>
          <Activity size={11} /> {formatTokens(run.usage.inputTokens + run.usage.outputTokens)} tokens
        </span>
        <span>
          <Zap size={11} /> {run.simulated ? 'simulated synthesis' : 'live synthesis'}
        </span>
        <span className="mono">{run.model}</span>
        {!active && <span className="live-run__done">Run closed</span>}
      </footer>
    </article>
  );
}
