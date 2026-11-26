import { useEffect, useRef, useState } from "react";
import {
  CopyPlus,
  FilePlus,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { formatDuration, formatRelativeTimestamp } from "../../lib/format";

interface EditorHeaderProps {
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectUpdatedAt: string | null;
  isDirty: boolean;
  saving?: boolean;
  segmentCount: number;
  totalDurationSec: number;
  isNarrow?: boolean;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onNewProject: () => void;
  onOpenClipPicker: () => void;
  onRequestClear: () => void;
}

export function EditorHeader({
  activeProjectId,
  activeProjectName,
  activeProjectUpdatedAt,
  isDirty,
  saving = false,
  segmentCount,
  totalDurationSec,
  isNarrow = false,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onNewProject,
  onOpenClipPicker,
  onRequestClear,
}: EditorHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const displayName = activeProjectName || "Untitled Project";
  const nameTooltip =
    activeProjectName && activeProjectUpdatedAt
      ? `${activeProjectName} · Last saved ${formatRelativeTimestamp(activeProjectUpdatedAt)}`
      : displayName;

  const btnHeightClass = isNarrow ? "min-h-[44px] px-3" : "h-8 px-2.5";
  const iconBtnClass = isNarrow ? "min-h-[44px] w-[44px]" : "h-8 w-8";
  const saveDisabled = (segmentCount === 0 && !activeProjectId) || saving;

  return (
    <header className="flex min-h-[36px] shrink-0 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h1
          data-testid="editor-project-title"
          title={nameTooltip}
          className="font-display max-w-[180px] truncate text-[15px] font-semibold text-[var(--text-primary)] sm:max-w-[240px] lg:max-w-[320px]"
        >
          {displayName}
        </h1>

        {activeProjectId !== null && !isDirty ? (
          <span
            data-testid="editor-project-status"
            aria-live="polite"
            className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-[var(--status-success-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-success-fg)]"
          >
            Saved
          </span>
        ) : isDirty ? (
          <span
            data-testid="editor-project-status"
            aria-live="polite"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--status-warning-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-warning-fg)]"
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-[var(--status-warning-fg)]"
              aria-hidden="true"
            />
            Unsaved
          </span>
        ) : null}

        <span className="font-mono-tabular hidden shrink-0 text-[12px] text-[var(--text-secondary)] xl:inline">
          {segmentCount} {segmentCount === 1 ? "segment" : "segments"} ·{" "}
          {formatDuration(totalDurationSec)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenProject}
          title="Open project (Ctrl+O)"
          data-testid="editor-open-project-btn"
          className={`btn-secondary ${btnHeightClass} gap-1.5 text-[12px]`}
        >
          <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Open</span>
        </button>

        <button
          type="button"
          onClick={onSaveProject}
          disabled={saveDisabled}
          title={
            activeProjectId
              ? "Save project (Ctrl+S)"
              : "Save as new project (Ctrl+S)"
          }
          data-testid="editor-save-project-btn"
          className={`${isDirty ? "btn-primary" : "btn-secondary"} ${btnHeightClass} gap-1.5 text-[12px]`}
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{saving ? "Saving..." : "Save"}</span>
        </button>

        <button
          type="button"
          onClick={onOpenClipPicker}
          data-testid="editor-add-clips-btn"
          className={`btn-secondary ${btnHeightClass} gap-1.5 text-[12px]`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            <span className="hidden md:inline">Add </span>Clips
          </span>
        </button>

        <div ref={menuWrapRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="Project actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="editor-project-menu-btn"
            className={`btn-secondary ${iconBtnClass} p-0`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label="Project actions"
              className="glass-dock popover-enter-down absolute top-full right-0 z-40 mt-1.5 min-w-[200px] rounded-[12px] p-1.5"
            >
              <button
                type="button"
                role="menuitem"
                disabled={segmentCount === 0}
                onClick={() => {
                  setMenuOpen(false);
                  onSaveProjectAs();
                }}
                className="flex w-full items-center justify-between gap-3 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] font-medium text-[var(--text-primary)] transition-colors duration-[110ms] hover:bg-slate-900/[0.06] disabled:opacity-45"
              >
                <span className="flex items-center gap-2">
                  <CopyPlus className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                  Save As...
                </span>
                <span className="font-mono-tabular text-[10px] text-[var(--text-muted)]">
                  Ctrl+Shift+S
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                disabled={activeProjectId === null && segmentCount === 0}
                onClick={() => {
                  setMenuOpen(false);
                  onNewProject();
                }}
                className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] font-medium text-[var(--text-primary)] transition-colors duration-[110ms] hover:bg-slate-900/[0.06] disabled:opacity-45"
              >
                <FilePlus className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                New Project
              </button>

              <div className="my-1 h-px bg-[var(--border-hairline)]" />

              <button
                type="button"
                role="menuitem"
                disabled={segmentCount === 0}
                onClick={() => {
                  setMenuOpen(false);
                  onRequestClear();
                }}
                className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] font-medium text-[var(--status-error-fg)] transition-colors duration-[110ms] hover:bg-[var(--status-error-bg)] disabled:opacity-45"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Clear Timeline
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
