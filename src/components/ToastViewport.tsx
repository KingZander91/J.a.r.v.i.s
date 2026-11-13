import { AlertTriangle, Bell, CheckCircle2, Info, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: Bell,
};

export function ToastViewport() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);

  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        return (
          <div key={toast.id} className={`toast toast--${toast.type}`} role="status">
            <span className="toast__icon">
              <Icon size={15} />
            </span>
            <span className="toast__msg">{toast.message}</span>
            <button
              className="toast__close"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={13} />
            </button>
            <span className="toast__timer" />
          </div>
        );
      })}
    </div>
  );
}
