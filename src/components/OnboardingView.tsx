import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FolderOpen, FolderSearch, HardDrive } from "lucide-react";
import { GlintMark } from "./GlintMark";
import { api, isTauriRuntime } from "../lib/api";
import { formatSourceTypeLabel, joinSuggestedHardlinkDir } from "../lib/format";
import type { DetectedRecorder, SourceType } from "../lib/types";

interface OnboardingViewProps {
  initialHardlinkDir: string;
  onComplete: (watchPath: string, hardlinkDir: string, sourceType?: SourceType) => Promise<void>;
  onSkip: () => void;
}

export function OnboardingView({
  initialHardlinkDir,
  onComplete,
  onSkip,
}: OnboardingViewProps) {
  const [detectedRecorders, setDetectedRecorders] = useState<DetectedRecorder[]>([]);
  const [detecting, setDetecting] = useState(true);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [selectedSourceType, setSelectedSourceType] = useState<SourceType>("custom");
  const [hardlinkDir, setHardlinkDir] = useState(initialHardlinkDir);
  const [manualInputOpen, setManualInputOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runRecorderScan = useCallback(
    async (preserveCurrentSelection: boolean) => {
      setError(null);
      setDetectMessage(null);
      setDetecting(true);
      try {
        const list = await api.detectAllRecorders();
        const found = list.filter((rec) => rec.found && Boolean(rec.path));
        setDetectedRecorders(found);

        if (found.length > 0 && (!preserveCurrentSelection || !selectedFolder.trim())) {
          const first = found[0];
          const firstPath = first.path ?? "";
          setSelectedFolder(firstPath);
          setSelectedSourceType(first.sourceType);
          if (!initialHardlinkDir && !hardlinkDir) {
            setHardlinkDir(joinSuggestedHardlinkDir(firstPath));
          }
        } else if (found.length === 0 && preserveCurrentSelection) {
          setDetectMessage(
            "No default recorder folders found on this PC. Select any folder manually."
          );
        }
      } catch {
        if (preserveCurrentSelection) {
          setDetectMessage("Could not scan recorder folders automatically.");
        }
      } finally {
        setDetecting(false);
      }
    },
    [hardlinkDir, initialHardlinkDir, selectedFolder]
  );

  useEffect(() => {
    let mounted = true;
    setDetecting(true);
    api
      .detectAllRecorders()
      .then((list) => {
        if (!mounted) return;
        const found = list.filter((rec) => rec.found && Boolean(rec.path));
        setDetectedRecorders(found);
        if (found.length > 0) {
          const first = found[0];
          const firstPath = first.path ?? "";
          setSelectedFolder(firstPath);
          setSelectedSourceType(first.sourceType);
          if (!initialHardlinkDir) {
            setHardlinkDir(joinSuggestedHardlinkDir(firstPath));
          }
        }
      })
      .catch(() => {
        if (mounted) setDetectedRecorders([]);
      })
      .finally(() => {
        if (mounted) setDetecting(false);
      });
    return () => {
      mounted = false;
    };
  }, [initialHardlinkDir]);

  const handleSelectRecorder = (rec: DetectedRecorder) => {
    if (!rec.path) return;
    setError(null);
    setDetectMessage(null);
    setSelectedFolder(rec.path);
    setSelectedSourceType(rec.sourceType);
    if (!hardlinkDir || !initialHardlinkDir) {
      setHardlinkDir(joinSuggestedHardlinkDir(rec.path));
    }
  };

  const handleChooseWatchFolder = async () => {
    setError(null);
    setDetectMessage(null);
    if (!isTauriRuntime()) {
      setManualInputOpen(true);
      setSelectedSourceType("custom");
      return;
    }
    const picked = await api.pickDirectory("Choose Video Clip Folder");
    if (picked) {
      setSelectedFolder(picked);
      setSelectedSourceType("custom");
      if (!hardlinkDir) {
        setHardlinkDir(joinSuggestedHardlinkDir(picked));
      }
    }
  };

  const handleChooseHardlinkDir = async () => {
    if (!isTauriRuntime()) {
      setManualInputOpen(true);
      return;
    }
    const picked = await api.pickDirectory("Choose Hardlink Export Folder");
    if (picked) {
      setHardlinkDir(picked);
    }
  };

  const handleStart = async () => {
    const cleanPath = selectedFolder.trim();
    if (!cleanPath || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onComplete(
        cleanPath,
        hardlinkDir.trim() || joinSuggestedHardlinkDir(cleanPath),
        selectedSourceType
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect folder.");
      setSubmitting(false);
    }
  };

  const hasValidFolder = selectedFolder.trim().length > 0;
  const matchedRecorder = detectedRecorders.find(
    (r) => r.path && r.path.toLowerCase() === selectedFolder.trim().toLowerCase()
  );

  return (
    <main className="flex flex-1 items-center justify-center overflow-y-auto bg-[var(--surface-canvas)] p-6">
      <div className="glass-dock view-enter w-full max-w-[540px] rounded-[16px] p-8">
        <div className="flex items-center gap-2.5">
          <GlintMark className="h-5 w-5 text-[var(--text-primary)]" />
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">Glint</span>
        </div>

        <h1 className="font-display mt-4 text-[22px] leading-7 font-semibold tracking-tight text-[var(--text-primary)]">
          Connect your clip folder
        </h1>
        <p className="mt-1.5 text-[14px] leading-[21px] text-[var(--text-secondary)]">
          Glint indexes NVIDIA ShadowPlay, AMD ReLive, OBS, Steam, Medal.tv, Ascent.gg, and other local video folders without moving files.
        </p>

        <div className="mt-6 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-4 shadow-[var(--border-card-specular)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FolderSearch className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Clip Watch Folder
                </span>
              </div>

              {detecting ? (
                <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                  Scanning installed game recorders and clip folders...
                </p>
              ) : hasValidFolder ? (
                <div className="mt-2 space-y-1.5">
                  <div className="inline-flex items-center gap-1.5 rounded-md bg-[var(--status-success-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-success-fg)]">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {matchedRecorder
                      ? `${formatSourceTypeLabel(matchedRecorder.sourceType)} folder found`
                      : "Folder selected"}
                  </div>
                  <p className="font-mono-tabular break-all text-[12px] text-[var(--text-primary)]">
                    {selectedFolder}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
                  No default recorder folder detected. Select any local video or clip folder below.
                </p>
              )}

              {detectMessage && (
                <p className="mt-2 text-[12px] text-[var(--status-warning-fg)]">
                  {detectMessage}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleChooseWatchFolder}
              className="btn-secondary h-9 shrink-0 px-3 text-[12px]"
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {hasValidFolder ? "Change Folder" : "Choose Clip Folder"}
            </button>
          </div>

          {!detecting && detectedRecorders.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-hairline)] pt-3">
              <span className="mr-1 text-[11px] font-medium text-[var(--text-secondary)]">
                Detected:
              </span>
              {detectedRecorders.map((rec) => {
                const active =
                  rec.path &&
                  rec.path.toLowerCase() === selectedFolder.trim().toLowerCase();
                return (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => handleSelectRecorder(rec)}
                    aria-pressed={Boolean(active)}
                    className={`btn-toggle-pill rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      active
                        ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                        : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)] hover:border-[#475569] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {rec.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-hairline)] pt-3">
            <button
              type="button"
              onClick={() => void runRecorderScan(true)}
              disabled={detecting}
              className="btn-secondary h-8 px-3 text-[12px]"
            >
              <FolderSearch className="h-3.5 w-3.5" aria-hidden="true" />
              {detecting ? "Scanning..." : "Scan Recorders"}
            </button>
          </div>

          {manualInputOpen && (
            <div className="mt-3 border-t border-[var(--border-hairline)] pt-3">
              <label
                htmlFor="onboarding-manual-folder"
                className="block text-[12px] font-medium text-[var(--text-secondary)]"
              >
                Folder path
              </label>
              <input
                id="onboarding-manual-folder"
                type="text"
                value={selectedFolder}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedFolder(val);
                  if (val.trim()) {
                    setHardlinkDir(joinSuggestedHardlinkDir(val));
                  }
                }}
                placeholder="Enter your recorder or local video folder path"
                className="glint-input font-mono-tabular mt-1 h-9 w-full rounded-[8px] px-2.5 text-[12px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="mt-3 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-4 shadow-[var(--border-card-specular)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Hardlink Export Location
                </span>
              </div>
              <p className="font-mono-tabular mt-1.5 break-all text-[12px] text-[var(--text-primary)]">
                {hardlinkDir || "Auto-configured once a watch folder is selected"}
              </p>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                Placed on the same NTFS drive so Premiere and CapCut folders use zero extra space.
              </p>
            </div>
            <button
              type="button"
              onClick={handleChooseHardlinkDir}
              className="btn-secondary h-9 shrink-0 px-3 text-[12px]"
            >
              Change
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-[8px] bg-[var(--status-error-bg)] px-3 py-2 text-[12px] font-medium text-[var(--status-error-fg)]"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={submitting}
            className="nav-item-press inline-flex h-9 items-center justify-center rounded-[8px] px-3 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-slate-900/5 hover:text-[var(--text-primary)]"
          >
            Skip setup for now
          </button>

          <button
            type="button"
            onClick={handleStart}
            disabled={!hasValidFolder || submitting}
            title={!hasValidFolder ? "Choose a folder to continue" : undefined}
            className="btn-primary h-10 px-5 text-[13px]"
          >
            {submitting ? "Connecting..." : "Start Browsing Clips"}
          </button>
        </div>
      </div>
    </main>
  );
}
