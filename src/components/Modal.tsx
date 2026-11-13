import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  bodyClassName?: string;
  closeOnBackdrop?: boolean;
  showClose?: boolean;
}

let openModals = 0;

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  icon,
  children,
  footer,
  width = 720,
  className,
  bodyClassName,
  closeOnBackdrop = true,
  showClose = true,
}: ModalProps) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openModals += 1;
    document.documentElement.classList.add('modal-open');
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        '[data-autofocus], input:not([type="hidden"]), textarea, select',
      );
      (target ?? panelRef.current)?.focus();
    }, 40);

    return () => {
      window.clearTimeout(timer);
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) document.documentElement.classList.remove('modal-open');
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusables = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  };

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && onClose) onClose();
      }}
    >
      <section
        ref={panelRef}
        className={cn('modal', className)}
        style={{ width: `min(${width}px, 100%)` }}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="modal__head">
          <div className="modal__heading">
            {icon && <span className="modal__icon">{icon}</span>}
            <div className="modal__title-wrap">
              {eyebrow && <div className="eyebrow">{eyebrow}</div>}
              <h2 className="modal__title">{title}</h2>
              {subtitle && <div className="modal__subtitle">{subtitle}</div>}
            </div>
          </div>
          {showClose && onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
              <X size={16} />
            </button>
          )}
        </header>
        <div className={cn('modal__body', bodyClassName)}>{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </section>
    </div>
  );
}
