import { useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useDialogModal } from "../hooks/useDialogModal";
import { usePresence } from "../hooks/usePresence";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const { present, isExiting } = usePresence(open, 130);

  useDialogModal({
    open,
    containerRef,
    initialFocusRef: cancelBtnRef,
    onClose: () => {
      if (!busy) onCancel();
    },
  });

  if (!present) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 ${
        isExiting ? "modal-backdrop-exit pointer-events-none" : "modal-backdrop-enter"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className={`glass-dock w-full max-w-[440px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {destructive && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--status-error-bg)] text-[var(--status-error-fg)]">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <h2
              id="confirm-modal-title"
              className="text-[16px] font-semibold text-[var(--text-primary)]"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close modal"
            className="btn-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-[14px] leading-[21px] text-[var(--text-secondary)]">
          {description}
        </p>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary h-9 px-4 text-[13px]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              destructive
                ? "btn-danger h-9 px-4 text-[13px]"
                : "btn-primary h-9 px-4 text-[13px]"
            }
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
