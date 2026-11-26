import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Loader2, Search, Trash2, X } from "lucide-react";
import { useDialogModal } from "../../hooks/useDialogModal";
import { usePresence } from "../../hooks/usePresence";
import { api } from "../../lib/api";
import { formatDuration, formatRelativeTimestamp } from "../../lib/format";
import type { EditorProjectSummary } from "../../lib/types";

interface OpenProjectModalProps {
  open: boolean;
  activeProjectId: string | null;
  isDirty: boolean;
  currentSegmentCount: number;
  openError?: string | null;
  onSelectProject: (project: EditorProjectSummary) => Promise<void> | void;
  onDeleteProject: (project: EditorProjectSummary) => Promise<void> | void;
  onRequestSaveCurrent: () => void;
  onClose: () => void;
}

export function OpenProjectModal({
  open,
  activeProjectId,
  isDirty,
  currentSegmentCount,
  openError,
  onSelectProject,
  onDeleteProject,
  onRequestSaveCurrent,
  onClose,
}: OpenProjectModalProps) {
  const [projects, setProjects] = useState<EditorProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const { present, isExiting } = usePresence(open, 140);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await api.listEditorProjects();
      setProjects(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setConfirmDeleteId(null);
    setDeletingId(null);
    setOpeningId(null);
    void loadList();
  }, [loadList, open]);

  useEffect(() => {
    if (!open || loading || projects.length === 0) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [loading, open, projects.length]);

  useEffect(() => {
    if (!open || !confirmDeleteId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setConfirmDeleteId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [confirmDeleteId, open]);

  useDialogModal({
    open,
    containerRef,
    initialFocusRef: projects.length > 0 ? searchRef : closeBtnRef,
    onClose: () => {
      if (deletingId || openingId) return;
      if (confirmDeleteId) {
        setConfirmDeleteId(null);
        return;
      }
      onClose();
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  if (!present) return null;

  const handleConfirmDelete = async (project: EditorProjectSummary) => {
    setDeletingId(project.id);
    setError(null);
    try {
      await onDeleteProject(project);
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenClick = async (project: EditorProjectSummary) => {
    setOpeningId(project.id);
    setError(null);
    try {
      await onSelectProject(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 ${
        isExiting ? "modal-backdrop-exit pointer-events-none" : "modal-backdrop-enter"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !deletingId && !openingId) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-project-modal-title"
        className={`glass-dock w-full max-w-[560px] rounded-[16px] p-5 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="open-project-modal-title"
              className="text-[16px] font-semibold text-[var(--text-primary)]"
            >
              Open Project
            </h2>
            <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
              Reopen a saved timeline project to continue editing.
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            disabled={Boolean(deletingId || openingId)}
            aria-label="Close modal"
            className="btn-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {projects.length >= 1 && (
          <div className="relative mt-4">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search saved projects"
              placeholder="Search projects..."
              className="glint-input h-9 w-full rounded-[8px] pr-3 pl-9 text-[13px] text-[var(--text-primary)]"
            />
          </div>
        )}

        <div className="mt-4">
          {openError && !loading && !error && (
            <div
              role="alert"
              className="mb-3 rounded-[10px] border border-red-200 bg-[var(--status-error-bg)] px-3 py-2 text-[12px] font-medium text-[var(--status-error-fg)]"
            >
              {openError}
            </div>
          )}
          {loading ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-[13px] text-[var(--text-secondary)]">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-primary)]" aria-hidden="true" />
              <span>Loading saved projects...</span>
            </div>
          ) : error ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[10px] bg-[var(--status-error-bg)] p-4 text-center">
              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-[var(--status-error-fg)]">
                  Could not load saved projects.
                </p>
                <p className="text-[12px] text-[var(--status-error-fg)]/85">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => void loadList()}
                className="btn-secondary h-8 px-3 text-[12px]"
              >
                Retry
              </button>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-5 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-white/80 text-[var(--text-secondary)]">
                <FolderOpen className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                  No saved projects yet.
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                  Save your current timeline to reopen it later.
                </p>
              </div>
              {currentSegmentCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRequestSaveCurrent();
                  }}
                  className="btn-primary h-8 px-3 text-[12px]"
                >
                  Save Current Timeline
                </button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-5 text-center">
              <p className="text-[13px] text-[var(--text-secondary)]">
                No projects match &quot;{query.trim()}&quot;.
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="btn-secondary h-8 px-3 text-[12px]"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="glint-scroll flex max-h-[340px] flex-col gap-2 overflow-y-auto pr-0.5">
              {filtered.map((project) => {
                const isCurrent = project.id === activeProjectId;
                const isConfirmingDelete = confirmDeleteId === project.id;
                const isDeletingThis = deletingId === project.id;
                const openLabel = isCurrent ? (isDirty ? "Reload" : "Opened") : "Open";
                const openDisabled =
                  (isCurrent && !isDirty) || Boolean(deletingId || openingId);

                return (
                  <div
                    key={project.id}
                    data-testid={`open-project-row-${project.id}`}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] px-3 py-2.5 transition-colors duration-[120ms] hover:bg-[var(--surface-card-hover)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                          {project.name}
                        </span>
                        {isCurrent && (
                          <span className="shrink-0 rounded-[5px] bg-[var(--accent-tint-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="font-mono-tabular mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                        {project.segmentCount}{" "}
                        {project.segmentCount === 1 ? "segment" : "segments"} ·{" "}
                        {formatDuration(project.totalDurationSec)} · Updated{" "}
                        {formatRelativeTimestamp(project.updatedAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {isConfirmingDelete ? (
                        <>
                          <span className="text-[11px] font-medium text-[var(--status-error-fg)]">
                            Delete?
                          </span>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={isDeletingThis}
                            className="btn-secondary h-7 px-2 text-[11px]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleConfirmDelete(project)}
                            disabled={isDeletingThis}
                            className="btn-danger h-7 px-2 text-[11px]"
                          >
                            {isDeletingThis ? "Deleting..." : "Delete"}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={openDisabled}
                            onClick={() => void handleOpenClick(project)}
                            className="btn-secondary h-8 px-3 text-[12px]"
                          >
                            {openingId === project.id ? "Opening..." : openLabel}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete project ${project.name}`}
                            disabled={Boolean(deletingId || openingId)}
                            onClick={() => setConfirmDeleteId(project.id)}
                            className="btn-icon flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--status-error-bg)] hover:text-[var(--status-error-fg)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
