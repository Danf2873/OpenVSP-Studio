import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import s from "./ui.module.css";
import { cx } from "./cx";
import { IconButton } from "./Button";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "sheet" slides up from the bottom edge. */
  variant?: "modal" | "sheet";
  className?: string;
}

export function Modal({ open, onClose, title, children, footer, variant = "modal", className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prev = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>("input,select,textarea,button:not([aria-label='Close'])");
    (first ?? panelRef.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={s.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(s.modal, variant === "sheet" && s.sheet, className)}
      >
        <div className={s.modalHead}>
          <span id={titleId} className={s.modalTitle}>
            {title}
          </span>
          <IconButton icon={<X size={16} />} label="Close" onClick={onClose} />
        </div>
        <div className={s.modalBody}>{children}</div>
        {footer && <div className={s.modalFoot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
