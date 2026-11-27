import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  Film,
  FolderOpen,
  Loader2,
  X,
} from "lucide-react";
import { useDialogModal } from "../../hooks/useDialogModal";
import { usePresence } from "../../hooks/usePresence";
import { api, getThumbStreamUrl, subscribeAppEvents } from "../../lib/api";
import { formatDuration } from "../../lib/format";
import { formatCustomPresetSpec } from "../../lib/presets";
import type {
  ClipSummary,
  CustomExportPreset,
  ExportPreset,
} from "../../lib/types";
import { GlassSelect } from "../GlassSelect";

type BatchPhase = "idle" | "running" | "completed" | "cancelled";
type ClipQueueStatus = "queued" | "running" | "done" | "failed" | "cancelled";

interface BatchItemState {
  clip: ClipSummary;
  status: ClipQueueStatus;
  percent: number;
  error?: string;
}

interface BatchExportModalProps {
  open: boolean;
  clips: ClipSummary[];
  customPresets: CustomExportPreset[];
  exportOutputDir: string;
  encoderLabel: string;
  streamerBaseUrl: string;
  streamerToken: string;
  onClose: () => void;
  onOpenExportSettings: () => void;
}

const BUILTIN_PRESET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "builtin:discord_10mb", label: "Discord (10 MB)" },
  { value: "builtin:discord_25mb", label: "25 MB" },
  { value: "builtin:lossless_trim", label: "Original (Lossless)" },
  { value: "builtin:vertical_blur_9_16", label: "9:16 Blur" },
  { value: "builtin:vertical_crop_9_16", label: "9:16 Crop" },
];

export function BatchExportModal({
  open,
  clips,
  customPresets,
  exportOutputDir,
  encoderLabel,
  streamerBaseUrl,
  streamerToken,
  onClose,
  onOpenExportSettings,
}: BatchExportModalProps) {
  const [items, setItems] = useState<BatchItemState[]>([]);
  const [phase, setPhase] = useState<BatchPhase>("idle");
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>("builtin:discord_10mb");
  const [normalizeAudio, setNormalizeAudio] = useState(false);
  const [stretch169, setStretch169] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [currentFileName, setCurrentFileName] = useState("");
  const [currentPercent, setCurrentPercent] = useState(0);
  const [outputDir, setOutputDir] = useState("");
  const [lastOutputPath, setLastOutputPath] = useState<string | null>(null);
  const [copiedLast, setCopiedLast] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const { present, isExiting } = usePresence(open, 130);

  useEffect(() => {
    if (!open) return;
    setItems(
      clips.map((clip) => ({
        clip,
        status: "queued",
        percent: 0,
      }))
    );
    setPhase("idle");
    setSelectedPresetKey("builtin:discord_10mb");
    setNormalizeAudio(false);
    setStretch169(false);
    setBatchId(null);
    setCompletedCount(0);
    setFailedCount(0);
    setCurrentFileName("");
    setCurrentPercent(0);
    setOutputDir(exportOutputDir);
    setLastOutputPath(null);
    setCopiedLast(false);
    setStartError(null);
    setCancelling(false);
  }, [clips, exportOutputDir, open]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useDialogModal({
    open,
    containerRef,
    initialFocusRef: closeBtnRef,
    onClose: () => {
      if (phase !== "running") onClose();
    },
  });

  useEffect(() => {
    if (!open || phase !== "running" || !batchId) return;
    let active = true;
    let unlisten: (() => void) | undefined;

    subscribeAppEvents({
      onBatchExportProgress: (payload) => {
        if (!active || payload.batchId !== batchId) return;
        setCompletedCount(payload.completedCount);
        setFailedCount(payload.failedCount);
        setCurrentFileName(payload.currentFileName);
        setCurrentPercent(payload.clipPercent);
        setItems((prev) =>
          prev.map((item, idx) => {
            if (item.clip.id === payload.currentClipId) {
              return { ...item, status: "running", percent: payload.clipPercent };
            }
            if (idx < payload.currentIndex && item.status === "running") {
              return { ...item, status: "done", percent: 100 };
            }
            return item;
          })
        );
      },
      onBatchExportCompleted: (payload) => {
        if (!active || payload.batchId !== batchId) return;
        setCompletedCount(payload.completedCount);
        setFailedCount(payload.failedCount);
        setOutputDir(payload.outputDir || exportOutputDir);
        setLastOutputPath(payload.lastOutputPath ?? null);
        setCancelling(false);
        const errorMap = new Map<string, string>();
        for (const err of payload.errors) {
          errorMap.set(err.clipId, err.error);
        }
        setItems((prev) =>
          prev.map((item) => {
            const errMsg = errorMap.get(item.clip.id);
            if (errMsg) {
              return { ...item, status: "failed", error: errMsg };
            }
            if (item.status === "done" || item.status === "running") {
              return { ...item, status: "done", percent: 100 };
            }
            if (payload.cancelled && item.status === "queued") {
              return { ...item, status: "cancelled" };
            }
            return { ...item, status: "done", percent: 100 };
          })
        );
        setPhase(payload.cancelled ? "cancelled" : "completed");
      },
    }).then((fn) => {
      if (active) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [batchId, exportOutputDir, open, phase]);

  const presetOptions = useMemo(() => {
    const customOpts = customPresets.map((p) => ({
      value: `custom:${p.id}`,
      label: `${p.name} (${formatCustomPresetSpec(p)})`,
    }));
    return [...BUILTIN_PRESET_OPTIONS, ...customOpts];
  }, [customPresets]);

  const handleSelectPreset = (key: string) => {
    setSelectedPresetKey(key);
    if (key.startsWith("custom:")) {
      const id = key.slice("custom:".length);
      const found = customPresets.find((p) => p.id === id);
      if (found) {
        setNormalizeAudio(found.audioNormalize);
        setStretch169(found.stretch169);
      }
    }
  };

  if (!present) return null;

  const totalDurationSec = items.reduce(
    (sum, entry) => sum + Math.max(0, entry.clip.durationSec || 0),
    0
  );
  const totalCount = items.length;
  const cancelledCount = items.filter((i) => i.status === "cancelled").length;
  const overallPct =
    totalCount > 0
      ? Math.min(
          100,
          Math.round(
            ((completedCount + failedCount + currentPercent / 100) / totalCount) * 100
          )
        )
      : 0;

  const handleStartBatch = async () => {
    if (items.length === 0 || phase === "running") return;
    setStartError(null);
    const isCustom = selectedPresetKey.startsWith("custom:");
    const customPresetId = isCustom ? selectedPresetKey.slice("custom:".length) : null;
    const preset: ExportPreset = isCustom
      ? "discord_10mb"
      : (selectedPresetKey.slice("builtin:".length) as ExportPreset);

    try {
      const res = await api.startBatchExport({
        clipIds: items.map((i) => i.clip.id),
        preset,
        customPresetId,
        audioNormalize: normalizeAudio,
        stretch169,
      });
      setBatchId(res.batchId);
      setPhase("running");
      setCurrentFileName(items[0]?.clip.fileName ?? "");
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Could not start batch export."
      );
    }
  };

  const handleCancelQueue = async () => {
    if (!batchId || cancelling) return;
    setCancelling(true);
    await api.cancelBatchExport(batchId).catch(() => {});
  };

  const handleCopyLastFile = async () => {
    if (!lastOutputPath) return;
    try {
      await api.copyFileToClipboard(lastOutputPath);
      setCopiedLast(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedLast(false), 2000);
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Could not copy file to clipboard."
      );
    }
  };

  const handleOpenFolder = async () => {
    const target = lastOutputPath || outputDir;
    if (!target) return;
    await api.openInExplorer(target).catch(() => {});
  };

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface-scrim-light)] p-4 ${
        isExiting ? "modal-exit pointer-events-none" : ""
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== "running") onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-export-title"
        className={`glass-dock w-full max-w-[540px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-tint-bg)] text-[var(--accent-primary)]">
              <Download className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="batch-export-title"
                className="text-[16px] font-semibold text-[var(--text-primary)]"
              >
                Batch Export
              </h2>
              <p className="font-mono-tabular text-[12px] text-[var(--text-secondary)]">
                {items.length} {items.length === 1 ? "clip" : "clips"} · ~
                {formatDuration(totalDurationSec)}
              </p>
            </div>
          </div>

          {phase !== "running" && (
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Close batch export modal"
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-slate-900/5 hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {phase === "idle" && (
          <div className="mt-4 space-y-4">
            <div className="glint-scroll max-h-[144px] space-y-1.5 overflow-y-auto rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2">
              {items.map(({ clip }) => {
                const thumbSrc = streamerBaseUrl
                  ? getThumbStreamUrl(streamerBaseUrl, streamerToken, clip.id, clip.thumbUrl)
                  : "";
                return (
                  <div
                    key={clip.id}
                    className="flex h-11 items-center gap-2.5 rounded-[7px] px-1.5 hover:bg-slate-900/[0.03]"
                  >
                    <div className="h-7 w-12 shrink-0 overflow-hidden rounded-[5px] bg-[var(--surface-cinema-frame)]">
                      {thumbSrc ? (
                        <img
                          src={thumbSrc}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/40">
                          <Film className="h-3.5 w-3.5" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                        {clip.title?.trim() || clip.fileName}
                      </p>
                      <p className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                        {formatDuration(clip.durationSec)}
                      </p>
                    </div>
                    {items.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove ${clip.title || clip.fileName} from batch`}
                        onClick={() =>
                          setItems((prev) => prev.filter((p) => p.clip.id !== clip.id))
                        }
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-muted)] hover:bg-slate-900/5 hover:text-[var(--text-primary)]"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
                Export Preset
              </span>
              <div className="mt-1">
                <GlassSelect
                  ariaLabel="Batch export preset"
                  value={selectedPresetKey}
                  options={presetOptions}
                  onChange={handleSelectPreset}
                  size="md"
                />
              </div>
              {customPresets.length === 0 && (
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                  <span>
                    Need custom bitrate or resolution? Create presets in Settings &gt; Export.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenExportSettings();
                    }}
                    className="shrink-0 font-semibold text-[var(--accent-primary)] hover:underline"
                  >
                    Open Settings
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1 border-t border-[var(--border-hairline)] pt-2">
              <label className="-mx-2 flex min-h-[36px] items-center gap-2.5 rounded-[8px] px-2 hover:bg-slate-900/5">
                <input
                  type="checkbox"
                  checked={normalizeAudio}
                  onChange={(e) => setNormalizeAudio(e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
                />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  Normalize audio loudness (loudnorm)
                </span>
              </label>
              <label className="-mx-2 flex min-h-[36px] items-center gap-2.5 rounded-[8px] px-2 hover:bg-slate-900/5">
                <input
                  type="checkbox"
                  checked={stretch169}
                  onChange={(e) => setStretch169(e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
                />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  Stretch non-16:9 clips to 16:9
                </span>
              </label>
              <p className="font-mono-tabular truncate pt-1 text-[11px] text-[var(--text-muted)]">
                Saving to: {exportOutputDir || "Default Exports folder"}
              </p>
            </div>

            {startError && (
              <p className="text-[12px] font-medium text-[var(--status-error-fg)]">
                {startError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary h-9 px-4 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleStartBatch()}
                className="btn-primary h-9 px-4 text-[13px]"
              >
                Start Batch ({items.length})
              </button>
            </div>
          </div>
        )}

        {phase === "running" && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                Exporting {Math.min(totalCount, completedCount + failedCount + 1)} of {totalCount}
              </span>
              <span className="font-mono-tabular rounded-[6px] border border-[var(--border-hairline)] bg-[var(--surface-control)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                {encoderLabel}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium text-[var(--text-secondary)]">
                  Overall Queue
                </span>
                <span className="font-mono-tabular font-semibold text-[var(--text-primary)]">
                  {completedCount} / {totalCount} clips
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-900/10">
                <div
                  className="h-full bg-[var(--accent-primary)] transition-[width] duration-150"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate font-semibold text-[var(--text-primary)]">
                  {currentFileName || "Preparing..."}
                </span>
                <span className="font-mono-tabular shrink-0 text-[var(--text-secondary)]">
                  {Math.round(currentPercent)}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900/10">
                <div
                  className="h-full bg-[#3b82f6] transition-[width] duration-150"
                  style={{ width: `${Math.min(100, Math.max(0, currentPercent))}%` }}
                />
              </div>
            </div>

            <div className="glint-scroll max-h-[180px] space-y-1.5 overflow-y-auto rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2">
              {items.map((item) => (
                <div
                  key={item.clip.id}
                  className="flex items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-[12px]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {item.status === "done" && (
                      <CheckCircle2
                        className="h-3.5 w-3.5 shrink-0 text-[var(--status-success-fg)]"
                        aria-hidden="true"
                      />
                    )}
                    {item.status === "running" && (
                      <Loader2
                        className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent-primary)]"
                        aria-hidden="true"
                      />
                    )}
                    {item.status === "queued" && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                    )}
                    {item.status === "failed" && (
                      <AlertCircle
                        className="h-3.5 w-3.5 shrink-0 text-[var(--status-error-fg)]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {item.clip.title?.trim() || item.clip.fileName}
                    </span>
                  </div>
                  <span className="font-mono-tabular shrink-0 text-[11px] text-[var(--text-muted)]">
                    {item.status === "running"
                      ? `${Math.round(item.percent)}%`
                      : item.status === "done"
                        ? "Done"
                        : item.status === "failed"
                          ? "Failed"
                          : "Queued"}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => void handleCancelQueue()}
                disabled={cancelling}
                className="btn-secondary h-9 px-4 text-[13px] text-[var(--status-error-fg)]"
              >
                {cancelling ? "Cancelling..." : "Cancel Queue"}
              </button>
            </div>
          </div>
        )}

        {(phase === "completed" || phase === "cancelled") && (
          <div className="mt-4 space-y-4">
            <div
              className={`rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold ${
                failedCount === 0 && cancelledCount === 0
                  ? "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]"
                  : "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]"
              }`}
            >
              {failedCount === 0 && cancelledCount === 0
                ? `Exported ${completedCount} of ${totalCount} clips`
                : `${completedCount} exported, ${failedCount} failed, ${cancelledCount} cancelled`}
            </div>

            <div className="glint-scroll max-h-[200px] space-y-1.5 overflow-y-auto rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2">
              {items.map((item) => (
                <div
                  key={item.clip.id}
                  className="flex items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-[12px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {item.status === "done" ? (
                        <CheckCircle2
                          className="h-3.5 w-3.5 shrink-0 text-[var(--status-success-fg)]"
                          aria-hidden="true"
                        />
                      ) : (
                        <AlertCircle
                          className="h-3.5 w-3.5 shrink-0 text-[var(--status-error-fg)]"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate font-medium text-[var(--text-primary)]">
                        {item.clip.title?.trim() || item.clip.fileName}
                      </span>
                    </div>
                    {item.error && (
                      <p className="mt-0.5 truncate pl-5 text-[11px] text-[var(--status-error-fg)]">
                        {item.error}
                      </p>
                    )}
                  </div>
                  <span className="font-mono-tabular shrink-0 text-[11px] text-[var(--text-muted)]">
                    {item.status === "done"
                      ? "Exported"
                      : item.status === "cancelled"
                        ? "Cancelled"
                        : "Failed"}
                  </span>
                </div>
              ))}
            </div>

            {startError && (
              <p className="text-[12px] font-medium text-[var(--status-error-fg)]">
                {startError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleOpenFolder()}
                  disabled={!lastOutputPath && !outputDir}
                  className="btn-secondary h-9 gap-1.5 px-3 text-[12px]"
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  Open Folder
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyLastFile()}
                  disabled={completedCount === 0 || !lastOutputPath}
                  className={`btn-secondary h-9 gap-1.5 px-3 text-[12px] ${
                    copiedLast
                      ? "border-[var(--status-success-fg)]/35 bg-[var(--status-success-bg)] text-[var(--status-success-fg)]"
                      : ""
                  }`}
                >
                  {copiedLast ? (
                    <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copiedLast ? "Copied" : "Copy Last File"}
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary h-9 px-4 text-[13px]"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
