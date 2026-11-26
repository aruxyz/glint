import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, isTauriRuntime } from "../../lib/api";
import { formatHardwareEncoderLabel, getWindowsDrive } from "../../lib/format";
import type { AppSettings, WatchFolder } from "../../lib/types";

export type EncoderPreference = "nvenc" | "cpu";

interface ExportTabProps {
  draft: AppSettings;
  setDraft: Dispatch<SetStateAction<AppSettings>>;
  watchFolders: WatchFolder[];
  hasNvenc: boolean;
  hasAmf: boolean;
  hasQsv: boolean;
  hardwareEncoder: string | null;
  ffmpegAvailable: boolean;
  encoderPref: EncoderPreference;
  onEncoderPrefChange: (pref: EncoderPreference) => void;
  savingSettings: boolean;
  saveFeedback: string | null;
  onSaveSettings: (nextSettings: AppSettings) => Promise<void>;
}

export function ExportTab({
  draft,
  setDraft,
  watchFolders,
  hasNvenc,
  hasAmf,
  hasQsv,
  hardwareEncoder,
  ffmpegAvailable,
  encoderPref,
  onEncoderPrefChange,
  savingSettings,
  saveFeedback,
  onSaveSettings,
}: ExportTabProps) {
  const handleBrowseField = async (
    field: "hardlinkBaseDir" | "exportOutputDir",
    title: string
  ) => {
    const picked = await api.pickDirectory(title);
    if (picked) {
      setDraft((prev) => ({ ...prev, [field]: picked }));
    }
  };

  const watchDrives = Array.from(
    new Set(
      watchFolders
        .map((wf) => getWindowsDrive(wf.path))
        .filter((d): d is string => Boolean(d))
    )
  );
  const hardlinkDrive = getWindowsDrive(draft.hardlinkBaseDir);
  const isCrossDrive =
    Boolean(hardlinkDrive) &&
    watchDrives.length > 0 &&
    !watchDrives.includes(hardlinkDrive as string);

  const hasGpuEncoder = Boolean(hasNvenc || hasAmf || hasQsv || hardwareEncoder);
  const gpuLabel = formatHardwareEncoderLabel(
    hardwareEncoder,
    hasNvenc,
    hasAmf,
    hasQsv
  );
  const inTauri = isTauriRuntime();

  return (
    <section aria-labelledby="settings-export-heading">
      <h1
        id="settings-export-heading"
        className="text-[18px] font-semibold text-[var(--text-primary)]"
      >
        Export & Hardlinks
      </h1>
      <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
        Configure where clipped exports and NTFS hardlink folders are created.
      </p>

      <div className="mt-5 space-y-4 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-5 shadow-[var(--border-card-specular),var(--shadow-card-rest)]">
        <div>
          <label
            htmlFor="settings-hardlink-dir"
            className="block text-[13px] font-semibold text-[var(--text-primary)]"
          >
            Hardlink Folder Location
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="settings-hardlink-dir"
              type="text"
              value={draft.hardlinkBaseDir}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  hardlinkBaseDir: e.target.value,
                }))
              }
              placeholder="Same NTFS drive as your clips"
              className="glint-input font-mono-tabular h-9 flex-1 rounded-[8px] px-3 text-[12px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() =>
                handleBrowseField("hardlinkBaseDir", "Choose Hardlink Folder")
              }
              className="btn-secondary h-9 px-3 text-[12px]"
            >
              Browse
            </button>
          </div>

          {draft.hardlinkBaseDir && watchDrives.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[12px]">
              {isCrossDrive ? (
                <>
                  <AlertTriangle
                    className="h-3.5 w-3.5 shrink-0 text-[var(--status-warning-fg)]"
                    aria-hidden="true"
                  />
                  <span className="text-[var(--status-warning-fg)]">
                    Different drive ({hardlinkDrive}) than watch folders (
                    {watchDrives.join(", ")}). NTFS hardlinks require the same drive.
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2
                    className="h-3.5 w-3.5 shrink-0 text-[var(--status-success-fg)]"
                    aria-hidden="true"
                  />
                  <span className="text-[var(--status-success-fg)]">
                    Same drive as watch clips ({hardlinkDrive})
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="settings-export-dir"
            className="block text-[13px] font-semibold text-[var(--text-primary)]"
          >
            Clip Export Output Folder
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="settings-export-dir"
              type="text"
              value={draft.exportOutputDir}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  exportOutputDir: e.target.value,
                }))
              }
              placeholder="Default app exports directory"
              className="glint-input font-mono-tabular h-9 flex-1 rounded-[8px] px-3 text-[12px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() =>
                handleBrowseField("exportOutputDir", "Choose Export Output Folder")
              }
              className="btn-secondary h-9 px-3 text-[12px]"
            >
              Browse
            </button>
          </div>
        </div>

        <div className="space-y-1 border-t border-[var(--border-hairline)] pt-3">
          <label className="-mx-2 flex min-h-[40px] items-center gap-2.5 rounded-[8px] px-2 transition-colors hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={draft.autoCopyExportToClipboard}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  autoCopyExportToClipboard: e.target.checked,
                }))
              }
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              Auto-copy exported clip to Windows Clipboard
            </span>
          </label>

          <label className="-mx-2 flex min-h-[40px] items-center gap-2.5 rounded-[8px] px-2 transition-colors hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={draft.defaultAutoNext}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  defaultAutoNext: e.target.checked,
                }))
              }
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              Enable Auto-Next by default when playing a folder
            </span>
          </label>
        </div>

        <div className="border-t border-[var(--border-hairline)] pt-3">
          <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
            Window & Background
          </span>
          <label className="-mx-2 mt-1 flex min-h-[40px] items-center gap-2.5 rounded-[8px] px-2 transition-colors hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={Boolean(draft.minimizeToTray)}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  minimizeToTray: e.target.checked,
                }))
              }
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              Minimize to System Tray on close
            </span>
          </label>
          <p className="mt-0.5 pl-[26px] text-[12px] text-[var(--text-muted)]">
            Closes the UI window (~10 MB RAM, 0% GPU) and pauses clip indexing while playing fullscreen games.
          </p>
        </div>

        <div className="border-t border-[var(--border-hairline)] pt-4">
          <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
            Hardware Encoder
          </span>
          <div className="mt-1.5 space-y-1">
            <label className="-mx-2 flex min-h-[40px] items-center gap-2.5 rounded-[8px] px-2 transition-colors hover:bg-slate-900/5">
              <input
                type="radio"
                name="hardware-encoder"
                checked={encoderPref === "nvenc"}
                onChange={() => onEncoderPrefChange("nvenc")}
                className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
              />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                {hasGpuEncoder
                  ? `Hardware GPU (${gpuLabel})`
                  : "Hardware GPU (unavailable, using CPU x264)"}
              </span>
            </label>
            <label className="-mx-2 flex min-h-[40px] items-center gap-2.5 rounded-[8px] px-2 transition-colors hover:bg-slate-900/5">
              <input
                type="radio"
                name="hardware-encoder"
                checked={encoderPref === "cpu"}
                onChange={() => onEncoderPrefChange("cpu")}
                className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
              />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                CPU (x264)
              </span>
            </label>
          </div>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            {!inTauri
              ? "FFmpeg status is checked in the desktop app"
              : !ffmpegAvailable
                ? "FFmpeg binary was not detected on this system"
                : hasGpuEncoder
                  ? `${gpuLabel} detected and ready`
                  : "No GPU encoder detected, exports will use CPU (x264)"}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {saveFeedback && (
            <span className="text-[12px] font-medium text-[var(--status-success-fg)]">
              {saveFeedback}
            </span>
          )}
          <button
            type="button"
            onClick={() => onSaveSettings(draft)}
            disabled={savingSettings}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            {savingSettings ? "Saving..." : "Save Export Settings"}
          </button>
        </div>
      </div>
    </section>
  );
}
