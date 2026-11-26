import { Download, RefreshCw, X } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";

interface UpdateModalProps {
  update: Update | null;
  installing: boolean;
  progressPercent: number | null;
  error: string | null;
  onUpdateNow: () => void;
  onLater: () => void;
}

export function UpdateModal({
  update,
  installing,
  progressPercent,
  error,
  onUpdateNow,
  onLater,
}: UpdateModalProps) {
  if (!update) return null;

  const notes = update.body?.trim() || "A new version of Glint is ready to install.";

  return (
    <div
      role="dialog"
      aria-labelledby="glint-update-title"
      data-testid="glint-update-modal"
      className="glass-dock fixed right-4 bottom-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-[14px] border border-[var(--border-hairline)] p-4 shadow-[var(--shadow-dock)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]">
            <Download className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2
              id="glint-update-title"
              className="text-[13px] font-semibold text-[var(--text-primary)]"
            >
              Update available
            </h2>
            <p className="font-mono-tabular text-[11px] font-medium text-[var(--accent-text)]">
              v{update.version}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLater}
          disabled={installing}
          aria-label="Close update prompt"
          className="btn-icon flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--text-muted)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <p className="mt-2.5 line-clamp-3 text-[12px] leading-[1.45] text-[var(--text-secondary)]">
        {notes}
      </p>

      {installing && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
            <span>Downloading update...</span>
            <span className="font-mono-tabular font-semibold">
              {progressPercent !== null ? `${progressPercent}%` : "..."}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900/10">
            <div
              className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-150"
              style={{ width: `${progressPercent ?? 15}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2.5 text-[11px] font-medium text-[var(--status-error-fg)]">
          {error}
        </p>
      )}

      <div className="mt-3.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onLater}
          disabled={installing}
          className="btn-secondary h-8 px-3 text-[12px] disabled:opacity-45"
        >
          Later
        </button>
        <button
          type="button"
          onClick={onUpdateNow}
          disabled={installing}
          className="btn-primary h-8 gap-1.5 px-3.5 text-[12px] disabled:opacity-65"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${installing ? "animate-spin" : ""}`} aria-hidden="true" />
          <span>{installing ? "Updating..." : "Update Now"}</span>
        </button>
      </div>
    </div>
  );
}
