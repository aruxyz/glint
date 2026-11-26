import { useRef } from "react";
import { X } from "lucide-react";
import { useDialogModal } from "../../hooks/useDialogModal";
import { usePresence } from "../../hooks/usePresence";

interface UnsavedChangesModalProps {
  open: boolean;
  activeProjectName: string | null;
  busy?: boolean;
  onSaveAndContinue: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesModal({
  open,
  activeProjectName,
  busy = false,
  onSaveAndContinue,
  onDiscard,
  onCancel,
}: UnsavedChangesModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const { present, isExiting } = usePresence(open, 140);

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
        aria-labelledby="unsaved-changes-modal-title"
        className={`glass-dock w-full max-w-[440px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="unsaved-changes-modal-title"
            className="text-[16px] font-semibold text-[var(--text-primary)]"
          >
            Unsaved changes
          </h2>
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
          {activeProjectName
            ? `Save changes to "${activeProjectName}" before switching?`
            : "Save your current timeline before switching?"}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary h-9 px-3.5 text-[13px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy}
            className="btn-secondary h-9 px-3.5 text-[13px] text-[var(--status-error-fg)]"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSaveAndContinue}
            disabled={busy}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            {busy ? "Saving..." : "Save & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
