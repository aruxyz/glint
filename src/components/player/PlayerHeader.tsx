import { ChevronLeft, FolderPlus, ListVideo, Star } from "lucide-react";
import type { ClipSummary } from "../../lib/types";

interface PlayerHeaderProps {
  clip: ClipSummary;
  displayTitle: string;
  sourceLabel: string;
  currentIndex: number;
  queueLength: number;
  autoNext: boolean;
  queueOpen: boolean;
  onBack: () => void;
  onToggleAutoNext: () => void;
  onToggleQueue: () => void;
  onOpenCollectionPicker: (clip: ClipSummary) => void;
  onToggleFavorite: (clip: ClipSummary) => void;
}

export function PlayerHeader({
  clip,
  displayTitle,
  sourceLabel,
  currentIndex,
  queueLength,
  autoNext,
  queueOpen,
  onBack,
  onToggleAutoNext,
  onToggleQueue,
  onOpenCollectionPicker,
  onToggleFavorite,
}: PlayerHeaderProps) {
  return (
    <div className="glass-toolbar flex h-12 shrink-0 items-center justify-between gap-3 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary h-8 shrink-0 gap-1.5 px-2.5 text-[12px]"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to {sourceLabel}
        </button>
        <h1 className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
          {displayTitle}
        </h1>
        {queueLength > 0 && currentIndex >= 0 && (
          <span className="font-mono-tabular shrink-0 text-[12px] text-[var(--text-secondary)]">
            Clip {currentIndex + 1} of {queueLength}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={autoNext}
          onClick={onToggleAutoNext}
          className={`btn-toggle-pill inline-flex h-8 items-center gap-2 rounded-[8px] border px-2.5 text-[12px] font-medium ${
            autoNext
              ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
              : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)]"
          }`}
        >
          <span>Auto-Next</span>
          <span className="font-mono-tabular text-[11px] font-semibold">
            {autoNext ? "ON" : "OFF"}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleQueue}
          aria-pressed={queueOpen}
          className={`btn-secondary h-8 px-2.5 text-[12px] ${
            queueOpen ? "border-[var(--accent-primary)] text-[var(--accent-text)]" : ""
          }`}
        >
          <ListVideo className="h-3.5 w-3.5" aria-hidden="true" />
          Queue
        </button>

        <button
          type="button"
          onClick={() => onOpenCollectionPicker(clip)}
          className="btn-secondary h-8 px-2.5 text-[12px]"
        >
          <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
          Collect
          {clip.collectionCount > 0 && (
            <span className="font-mono-tabular rounded bg-[var(--accent-tint-bg)] px-1 py-0.2 text-[10px] font-semibold text-[var(--accent-text)]">
              {clip.collectionCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onToggleFavorite(clip)}
          aria-label={clip.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          aria-pressed={clip.isFavorite}
          className={`btn-secondary h-8 w-8 p-0 ${
            clip.isFavorite ? "border-amber-500 bg-amber-50 text-amber-600" : ""
          }`}
        >
          <Star
            className="h-4 w-4"
            fill={clip.isFavorite ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
