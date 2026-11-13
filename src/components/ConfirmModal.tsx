import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { useAppStore } from '../store/useAppStore';

export function ConfirmModal() {
  const confirm = useAppStore((state) => state.ui.confirm);
  const closeConfirm = useAppStore((state) => state.closeConfirm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
  }, [confirm]);

  if (!confirm) return null;

  const run = async () => {
    setBusy(true);
    try {
      await confirm.onConfirm();
      closeConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={closeConfirm}
      title={confirm.title}
      eyebrow="Confirm directive"
      icon={<AlertTriangle size={18} />}
      width={480}
      footer={
        <>
          <button className="btn btn--ghost" onClick={closeConfirm} disabled={busy}>
            Cancel
          </button>
          <button
            className={confirm.danger ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={run}
            disabled={busy}
            data-autofocus
          >
            {busy ? 'Processing…' : (confirm.confirmLabel ?? 'Confirm')}
          </button>
        </>
      }
    >
      <p className="confirm__message">{confirm.message}</p>
    </Modal>
  );
}
