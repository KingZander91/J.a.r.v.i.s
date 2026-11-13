import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Modal } from './Modal';
import { useAppStore } from '../store/useAppStore';
import { useNow } from '../hooks/useNow';
import { formatElapsed } from '../lib/utils';

function prettyTool(name: string): string {
  return name.replace(/_/g, ' ');
}

export function ApprovalModal() {
  const run = useAppStore((state) => state.run);
  const approveAction = useAppStore((state) => state.approveAction);
  const approval = run?.approval ?? null;
  const now = useNow(500);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(null);
    setError(null);
  }, [approval?.id]);

  if (!approval) return null;

  const remaining = Math.max(0, approval.expiresAt - now);
  const expired = remaining <= 0;

  const resolve = async (approved: boolean) => {
    if (busy || expired) return;
    setBusy(approved ? 'approve' : 'deny');
    setError(null);
    try {
      await approveAction(approved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The authorization channel did not respond.');
      setBusy(null);
    }
  };

  const args = (() => {
    try {
      const serialized = JSON.stringify(approval.args, null, 2);
      return serialized.length > 5000 ? `${serialized.slice(0, 5000)}\n…` : serialized;
    } catch {
      return String(approval.args);
    }
  })();

  return (
    <Modal
      open
      title="Authorization required"
      subtitle={`${prettyTool(approval.toolName)} is gated behind operator approval.`}
      eyebrow="Security interlock"
      icon={<ShieldAlert size={19} />}
      width={580}
      closeOnBackdrop={false}
      showClose={false}
      className="modal--approval"
      footer={
        <>
          <span className={`approval__timer ${remaining < 30_000 ? 'is-critical' : ''}`}>
            Expires in {formatElapsed(remaining)}
          </span>
          <div className="modal__actions">
            <button
              className="btn btn--ghost"
              onClick={() => resolve(false)}
              disabled={Boolean(busy) || expired}
            >
              {busy === 'deny' ? 'Denying…' : 'Deny'}
            </button>
            <button
              className="btn btn--warning"
              onClick={() => resolve(true)}
              disabled={Boolean(busy) || expired}
              data-autofocus
            >
              {busy === 'approve' ? 'Authorizing…' : 'Authorize action'}
            </button>
          </div>
        </>
      }
    >
      <div className="approval__reason">{approval.reason}</div>
      <div className="approval__meta">
        <span className="badge badge--warn">{approval.category.toUpperCase()}</span>
        <span className="approval__run mono">RUN {approval.runId.slice(-8).toUpperCase()}</span>
      </div>
      <div className="code-readout">
        <div className="code-readout__head">
          <span>REQUESTED PAYLOAD</span>
          <span className="mono">{approval.toolName}()</span>
        </div>
        <pre>{args}</pre>
      </div>
      {expired && <div className="inline-error">The authorization window has expired. The core will continue without this action.</div>}
      {error && <div className="inline-error">{error}</div>}
      <p className="approval__note">
        Authorizing permits this single tool call. Nothing else is unlocked. Enable YOLO mode in
        settings to bypass approval gates.
      </p>
    </Modal>
  );
}
