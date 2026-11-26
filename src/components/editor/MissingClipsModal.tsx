import { useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useDialogModal } from "../../hooks/useDialogModal";
import { usePresence } from "../../hooks/usePresence";
import type { MissingProjectSegment } from "../../lib/types";

interface MissingClipsModalProps {
  open: boolean;
  projectName: string;
  availableCount: number;
  missingSegments: MissingProjectSegment[];
  busy?: boolean;
  onOpenAvailable: () => void;
  onDeleteProject: () => void;
  onClose: () => void;
}

export function MissingClipsModal({
  open,
  projectName,
  availableCount,
  missingSegments,
  busy = false,
  onOpenAvailable,
  onDeleteProject,
  onClose,
}: MissingClipsModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const { present, isExiting } = usePresence(open, 140);

  useDialogModal({
    open,
    containerRef,
    initialFocusRef: closeBtnRef,
    onClose: () => {
      if (!busy) onClose();
    },
  });

  if (!present) return null;

  const totalCount = availableCount + missingSegments.length;
  const visibleMissing = missingSegments.slice(0, 4);
  const overflowCount = Math.max(0, missingSegments.length - visibleMissing.length);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 ${
        isExiting ? "modal-backdrop-exit pointer-events-none" : "modal-backdrop-enter"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="missing-clips-modal-title"
        className={`glass-dock w-full max-w-[460px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2
              id="missing-clips-modal-title"
              className="text-[16px] font-semibold text-[var(--text-primary)]"
            >
              {availableCount > 0 ? "Some source clips are missing" : "Project clips unavailable"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close modal"
            className="btn-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-[14px] leading-[21px] text-[var(--text-secondary)]">
          {availableCount > 0
            ? `${missingSegments.length} of ${totalCount} segments in "${projectName}" could not be loaded because the source files were deleted or moved.`
            : `All source clips in "${projectName}" have been deleted or moved from your folders.`}
        </p>

        {visibleMissing.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] px-3 py-2.5">
            {visibleMissing.map((item) => (
              <li
                key={`${item.segmentIndex}-${item.clipId}`}
                className="font-mono-tabular flex items-center justify-between gap-2 text-[12px] text-[var(--text-secondary)]"
              >
                <span className="truncate text-[var(--text-primary)]">
                  {item.title || item.fileName}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--status-warning-fg)]">
                  {item.reason === "deleted" ? "Deleted from Library" : "File missing on disk"}
                </span>
              </li>
            ))}
            {overflowCount > 0 && (
              <li className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                + {overflowCount} more
              </li>
            )}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary h-9 px-4 text-[13px]"
          >
            {availableCount > 0 ? "Cancel" : "Close"}
          </button>
          {availableCount > 0 ? (
            <button
              type="button"
              onClick={onOpenAvailable}
              disabled={busy}
              className="btn-primary h-9 px-4 text-[13px]"
            >
              Open Available ({availableCount})
            </button>
          ) : (
            <button
              type="button"
              onClick={onDeleteProject}
              disabled={busy}
              className="btn-danger h-9 px-4 text-[13px]"
            >
              {busy ? "Deleting..." : "Delete Project"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
