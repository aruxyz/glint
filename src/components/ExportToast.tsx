import { useEffect, useState } from "react";
import { AlertCircle, Camera, CheckCircle2, Clapperboard, ClipboardCheck, FolderOpen, Play, X } from "lucide-react";
import { usePresence } from "../hooks/usePresence";
import { formatBytes, formatDuration } from "../lib/format";
import type { ClipSummary, ExportPreset } from "../lib/types";

export type ToastState =
  | {
      kind: "export_progress";
      jobId: string;
      fileName: string;
      preset: ExportPreset | "montage" | "editor";
      percent: number;
      etaSec: number | null;
      encoderLabel: string;
    }
  | {
      kind: "export_completed";
      outputPath: string;
      fileName: string;
      outputSizeBytes: number;
      copiedToClipboard: boolean;
      encoderUsed: string;
    }
  | {
      kind: "snapshot_saved";
      outputPath: string;
      fileName: string;
      copiedToClipboard: boolean;
    }
  | {
      kind: "export_error";
      message: string;
      canFallback25Mb?: boolean;
    }
  | {
      kind: "clip_saved";
      clip: ClipSummary;
      collectionCount: number;
    }
  | {
      kind: "editor_segment_added";
      clipTitle: string;
      durationSec: number;
      segmentCount: number;
    }
  | {
      kind: "hardlink_success";
      collectionName: string;
      folderPath: string;
      linkedCount: number;
    }
  | {
      kind: "hardlink_cross_drive";
      message: string;
    }
  | {
      kind: "info";
      title: string;
      detail?: string;
    };

interface ExportToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
  onCancelExport: (jobId: string) => void;
  onCopyAgain: (filePath: string) => void;
  onShowInFolder: (filePath: string) => void;
  onRetryExport25Mb?: () => void;
  onOpenSavedClip?: (clip: ClipSummary) => void;
  onOpenEditor?: () => void;
  onOpenSettingsExport: () => void;
}

function presetLabel(preset: ExportPreset | "montage" | "editor"): string {
  if (preset === "discord_10mb") return "Discord (10 MB)";
  if (preset === "discord_25mb") return "25 MB";
  if (preset === "vertical_blur_9_16") return "9:16 Blur";
  if (preset === "vertical_crop_9_16") return "9:16 Crop";
  if (preset === "editor") return "Editor";
  if (preset === "montage") return "Montage";
  return "Lossless";
}

export function ExportToast({
  toast,
  onDismiss,
  onCancelExport,
  onCopyAgain,
  onShowInFolder,
  onRetryExport25Mb,
  onOpenSavedClip,
  onOpenEditor,
  onOpenSettingsExport,
}: ExportToastProps) {
  const [paused, setPaused] = useState(false);
  const [displayedToast, setDisplayedToast] = useState<ToastState | null>(toast);
  const { present, isExiting } = usePresence(Boolean(toast), 150);

  useEffect(() => {
    if (toast) {
      setDisplayedToast(toast);
    }
  }, [toast]);

  useEffect(() => {
    if (!toast) return;
    if (toast.kind === "export_progress" || paused) return;
    const ms =
      toast.kind === "export_error" || toast.kind === "hardlink_cross_drive"
        ? 10000
        : toast.kind === "editor_segment_added"
          ? 3500
          : 7000;
    const timer = window.setTimeout(onDismiss, ms);
    return () => window.clearTimeout(timer);
  }, [toast, paused, onDismiss]);

  if (!present || !displayedToast) return null;

  const activeToast = displayedToast;

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`glass-hud fixed right-6 bottom-6 z-50 w-[360px] max-w-[calc(100vw-32px)] rounded-[12px] p-4 ${
        isExiting ? "toast-exit pointer-events-none" : "toast-enter"
      }`}
    >
      <div key={activeToast.kind} className="toast-body-enter">
        {activeToast.kind === "export_progress" && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                {activeToast.fileName}
              </span>
              <span className="font-mono-tabular shrink-0 rounded bg-slate-900/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                {activeToast.encoderLabel}
              </span>
            </div>

            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-150 ease-linear"
                style={{ width: `${Math.min(100, Math.max(2, activeToast.percent))}%` }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
              <span className="font-mono-tabular text-[var(--text-secondary)]">
                Encoding for {presetLabel(activeToast.preset)} · {Math.round(activeToast.percent)}%
                {activeToast.etaSec !== null ? ` · ~${Math.ceil(activeToast.etaSec)}s left` : ""}
              </span>
              <button
                type="button"
                onClick={() => onCancelExport(activeToast.jobId)}
                className="font-medium text-[var(--status-error-fg)] hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {activeToast.kind === "export_completed" && (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--status-success-bg)] text-[var(--status-success-fg)]">
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {activeToast.copiedToClipboard
                      ? "Copied to clipboard, ready to paste in Discord"
                      : "Export complete"}
                  </p>
                  <p className="font-mono-tabular mt-0.5 truncate text-[12px] text-[var(--text-secondary)]">
                    {activeToast.fileName} · {formatBytes(activeToast.outputSizeBytes)}
                    {activeToast.copiedToClipboard ? " · Ctrl+V" : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="btn-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onCopyAgain(activeToast.outputPath)}
                className="btn-secondary h-7 px-2.5 text-[12px]"
              >
                Copy Again
              </button>
              <button
                type="button"
                onClick={() => onShowInFolder(activeToast.outputPath)}
                className="btn-secondary h-7 px-2.5 text-[12px]"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Show in Folder
              </button>
            </div>
          </div>
        )}

        {activeToast.kind === "clip_saved" && (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--status-success-bg)] text-[var(--status-success-fg)]">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                    Saved trimmed clip
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-[var(--text-secondary)]">
                    {activeToast.clip.title || activeToast.clip.fileName} ·{" "}
                    <span className="font-mono-tabular">
                      {formatDuration(activeToast.clip.durationSec)}
                    </span>
                    {activeToast.collectionCount > 0
                      ? ` · Added to ${activeToast.collectionCount} ${activeToast.collectionCount === 1 ? "collection" : "collections"}`
                      : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="btn-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {onOpenSavedClip && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onOpenSavedClip(activeToast.clip);
                    onDismiss();
                  }}
                  className="btn-primary h-7 px-2.5 text-[12px]"
                >
                  <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                  Open Saved Clip
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="btn-secondary h-7 px-2.5 text-[12px]"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {activeToast.kind === "snapshot_saved" && (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--status-success-bg)] text-[var(--status-success-fg)]">
                  <Camera className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {activeToast.copiedToClipboard
                      ? "Snapshot copied to clipboard, ready to paste in Discord"
                      : "Snapshot saved"}
                  </p>
                  <p className="font-mono-tabular mt-0.5 truncate text-[12px] text-[var(--text-secondary)]">
                    {activeToast.fileName}
                    {activeToast.copiedToClipboard ? " · Ctrl+V" : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="btn-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onShowInFolder(activeToast.outputPath)}
                className="btn-secondary h-7 px-2.5 text-[12px]"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Show in Folder
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="btn-secondary h-7 px-2.5 text-[12px]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {activeToast.kind === "export_error" && (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--status-error-bg)] text-[var(--status-error-fg)]">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                    Export failed
                  </p>
                  <p className="mt-0.5 break-words text-[12px] text-[var(--text-secondary)]">
                    {activeToast.message}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="btn-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              {activeToast.canFallback25Mb && onRetryExport25Mb && (
                <button
                  type="button"
                  onClick={onRetryExport25Mb}
                  className="btn-primary h-7 px-2.5 text-[12px]"
                >
                  Export 25 MB
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                className="btn-secondary h-7 px-2.5 text-[12px]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {activeToast.kind === "hardlink_success" && (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--status-success-bg)] text-[var(--status-success-fg)]">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13px] font-semibold text-[var(--text-primary)]"
                    title={activeToast.collectionName}
                  >
                    Opened {activeToast.collectionName} in Explorer
                  </p>
                  <p className="font-mono-tabular mt-0.5 text-[12px] text-[var(--text-secondary)]">
                    {activeToast.linkedCount} clips linked (0 MB extra disk used)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="btn-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => onShowInFolder(activeToast.folderPath)}
                className="btn-secondary h-7 px-2.5 text-[12px]"
              >
                Open Folder Again
              </button>
            </div>
          </div>
        )}

        {activeToast.kind === "hardlink_cross_drive" && (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                    Cross-drive hardlink blocked
                  </p>
                  <p className="mt-0.5 break-words text-[12px] text-[var(--text-secondary)]">
                    {activeToast.message}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="btn-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenSettingsExport}
                className="btn-primary h-7 px-2.5 text-[12px]"
              >
                Open Settings
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="btn-secondary h-7 px-2.5 text-[12px]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {activeToast.kind === "editor_segment_added" && (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-tint-bg)] text-[var(--accent-text)]">
                  <Clapperboard className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                      Added to Editor
                    </p>
                    <span className="font-mono-tabular rounded-full bg-[var(--accent-tint-bg)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--accent-text)]">
                      {activeToast.segmentCount} total
                    </span>
                  </div>
                  <p className="font-mono-tabular mt-0.5 truncate text-[12px] text-[var(--text-secondary)]">
                    {activeToast.clipTitle} ({formatDuration(activeToast.durationSec)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="btn-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            {onOpenEditor && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDismiss();
                    onOpenEditor();
                  }}
                  className="btn-secondary h-7 px-2.5 text-[12px]"
                >
                  Open Editor
                </button>
              </div>
            )}
          </div>
        )}

        {activeToast.kind === "info" && (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                {activeToast.title}
              </p>
              {activeToast.detail && (
                <p className="mt-0.5 break-words text-[12px] text-[var(--text-secondary)]">
                  {activeToast.detail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss notification"
              className="btn-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
