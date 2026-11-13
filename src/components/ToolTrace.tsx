import {
  Ban,
  Check,
  Circle,
  Loader2,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react';
import type { ToolCallRecord, ToolStatus } from '../../shared/types';

export function prettyTool(name: string): string {
  return name.replace(/_/g, ' ');
}

export function formatDuration(milliseconds?: number): string {
  if (milliseconds == null) return '';
  if (milliseconds < 1000) return `${Math.max(1, Math.round(milliseconds))}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function ToolStatusIcon({ status, size = 12 }: { status: ToolStatus; size?: number }) {
  switch (status) {
    case 'success':
      return <Check size={size} strokeWidth={2.4} />;
    case 'running':
      return <Loader2 size={size} className="spin" />;
    case 'error':
      return <X size={size} strokeWidth={2.4} />;
    case 'denied':
      return <Ban size={size} />;
    case 'awaiting_approval':
      return <ShieldAlert size={size} />;
    case 'cancelled':
      return <Square size={size} />;
    default:
      return <Circle size={Math.max(7, size - 3)} />;
  }
}

export function ToolRow({ call, compact }: { call: ToolCallRecord; compact?: boolean }) {
  const detail =
    call.status === 'running'
      ? 'Executing…'
      : call.error ??
        call.summary ??
        call.resultPreview ??
        (call.requiresApproval ? 'Awaiting authority' : 'Queued');

  return (
    <div className={`tool-row ${compact ? 'tool-row--compact' : ''}`} data-status={call.status}>
      <span className="tool-row__icon">
        <ToolStatusIcon status={call.status} />
      </span>
      <div className="tool-row__body">
        <div className="tool-row__head">
          <span className="tool-row__name">{prettyTool(call.name)}</span>
          {call.category && <span className="tool-row__category">{call.category}</span>}
          {call.durationMs != null && (
            <span className="tool-row__duration">{formatDuration(call.durationMs)}</span>
          )}
        </div>
        <div className="tool-row__detail">{detail}</div>
      </div>
    </div>
  );
}
