import { useState } from "react";
import {
  CheckCircle2,
  FolderPlus,
  FolderSearch,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api, isTauriRuntime } from "../../lib/api";
import { formatSourceTypeLabel } from "../../lib/format";
import type { DetectedRecorder, SourceType, WatchFolder } from "../../lib/types";
import { GlassSelect } from "../GlassSelect";

const SOURCE_TYPE_OPTIONS: ReadonlyArray<{ value: SourceType; label: string }> = [
  { value: "nvidia", label: "NVIDIA ShadowPlay" },
  { value: "amd_relive", label: "AMD Radeon ReLive" },
  { value: "obs", label: "OBS Studio" },
  { value: "steam", label: "Steam Game Recording" },
  { value: "medal", label: "Medal.tv" },
  { value: "ascent", label: "Ascent.gg" },
  { value: "outplayed", label: "Outplayed" },
  { value: "steelseries", label: "SteelSeries Moments" },
  { value: "xbox", label: "Xbox Game Bar" },
  { value: "custom", label: "Custom Folder" },
];

interface WatchFoldersTabProps {
  watchFolders: WatchFolder[];
  onAddWatchFolder: (path: string, sourceType: SourceType) => Promise<void>;
  onToggleWatchFolder: (folderId: string, enabled: boolean) => Promise<void>;
  onRemoveWatchFolder: (folder: WatchFolder) => void;
  onScanFolder: (folderId?: string | null) => Promise<void>;
}

export function WatchFoldersTab({
  watchFolders,
  onAddWatchFolder,
  onToggleWatchFolder,
  onRemoveWatchFolder,
  onScanFolder,
}: WatchFoldersTabProps) {
  const [newFolderPath, setNewFolderPath] = useState("");
  const [newSourceType, setNewSourceType] = useState<SourceType>("nvidia");
  const [addingFolder, setAddingFolder] = useState(false);
  const [scanningRecorders, setScanningRecorders] = useState(false);
  const [detectedRecorders, setDetectedRecorders] = useState<DetectedRecorder[] | null>(
    null
  );
  const [addingDetectedId, setAddingDetectedId] = useState<string | null>(null);
  const [addingAllDetected, setAddingAllDetected] = useState(false);
  const [detectFeedback, setDetectFeedback] = useState<string | null>(null);
  const [manualAddOpen, setManualAddOpen] = useState(false);

  const isFolderAdded = (path: string | null): boolean =>
    Boolean(
      path &&
        watchFolders.some((wf) => wf.path.toLowerCase() === path.toLowerCase())
    );

  const handleBrowseAndAddWatchFolder = async () => {
    if (!isTauriRuntime()) {
      setManualAddOpen(true);
      return;
    }
    const picked = await api.pickDirectory("Select Clip Watch Folder");
    if (!picked) return;
    setAddingFolder(true);
    try {
      await onAddWatchFolder(picked, newSourceType);
    } finally {
      setAddingFolder(false);
    }
  };

  const handleManualAddSubmit = async () => {
    const clean = newFolderPath.trim();
    if (!clean || addingFolder) return;
    setAddingFolder(true);
    try {
      await onAddWatchFolder(clean, newSourceType);
      setNewFolderPath("");
      setManualAddOpen(false);
    } finally {
      setAddingFolder(false);
    }
  };

  const handleScanRecorders = async () => {
    if (scanningRecorders || addingFolder) return;
    setScanningRecorders(true);
    setDetectFeedback(null);
    try {
      const list = await api.detectAllRecorders();
      setDetectedRecorders(list);
      const found = list.filter((rec) => rec.found && Boolean(rec.path));
      if (found.length === 0) {
        setDetectFeedback(
          "No default recorder folders found on this PC. Use Add Custom Folder to select any local video directory."
        );
      }
    } catch {
      setDetectedRecorders([]);
      setDetectFeedback("Could not scan installed recorder folders.");
    } finally {
      setScanningRecorders(false);
    }
  };

  const handleAddDetectedRecorder = async (rec: DetectedRecorder) => {
    if (
      !rec.path ||
      isFolderAdded(rec.path) ||
      addingDetectedId ||
      addingAllDetected
    ) {
      return;
    }
    setAddingDetectedId(rec.id);
    try {
      await onAddWatchFolder(rec.path, rec.sourceType);
    } finally {
      setAddingDetectedId(null);
    }
  };

  const handleAddAllDetectedRecorders = async () => {
    const pending = (detectedRecorders ?? []).filter(
      (rec) => rec.found && rec.path && !isFolderAdded(rec.path)
    );
    if (pending.length === 0 || addingAllDetected) return;
    setAddingAllDetected(true);
    try {
      for (const rec of pending) {
        if (rec.path) {
          await onAddWatchFolder(rec.path, rec.sourceType);
        }
      }
    } finally {
      setAddingAllDetected(false);
    }
  };

  const foundRecorders =
    detectedRecorders?.filter((rec) => rec.found && Boolean(rec.path)) ?? [];
  const pendingRecorders = foundRecorders.filter(
    (rec) => !isFolderAdded(rec.path)
  );

  return (
    <section aria-labelledby="settings-folders-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1
            id="settings-folders-heading"
            className="text-[18px] font-semibold text-[var(--text-primary)]"
          >
            Watch Folders
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
            Supports NVIDIA ShadowPlay, AMD ReLive, OBS, Steam, Medal.tv, Ascent.gg, Outplayed, SteelSeries, Xbox Game Bar, or any local folder.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleScanRecorders}
            disabled={scanningRecorders || addingFolder || addingAllDetected}
            className="btn-secondary h-9 px-3 text-[12px]"
          >
            <FolderSearch
              className="h-4 w-4 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            {scanningRecorders ? "Scanning..." : "Scan Recorders"}
          </button>
          <GlassSelect
            ariaLabel="Folder source type"
            value={newSourceType}
            options={SOURCE_TYPE_OPTIONS}
            onChange={setNewSourceType}
            placement="down"
            size="md"
          />
          <button
            type="button"
            onClick={handleBrowseAndAddWatchFolder}
            disabled={addingFolder}
            className="btn-primary h-9 px-3.5 text-[13px]"
          >
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
            Add Custom Folder
          </button>
        </div>
      </div>

      {detectFeedback && (
        <div className="mt-3 rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-card)] px-3 py-2 text-[12px] text-[var(--text-secondary)] shadow-[var(--border-card-specular)]">
          {detectFeedback}
        </div>
      )}

      {detectedRecorders !== null && foundRecorders.length > 0 && (
        <div
          aria-label="Detected recorders"
          className="mt-4 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-4 shadow-[var(--border-card-specular),var(--shadow-card-rest)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Detected Recorders
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Found {foundRecorders.length} installed{" "}
                {foundRecorders.length === 1 ? "recorder folder" : "recorder folders"}.
              </p>
            </div>

            {pendingRecorders.length >= 2 && (
              <button
                type="button"
                onClick={handleAddAllDetectedRecorders}
                disabled={addingAllDetected || addingDetectedId !== null}
                className="btn-primary h-8 px-3 text-[12px]"
              >
                {addingAllDetected ? "Adding..." : "Add All Detected"}
              </button>
            )}
          </div>

          <div className="mt-3 divide-y divide-[var(--border-hairline)] border-t border-[var(--border-hairline)]">
            {foundRecorders.map((rec) => {
              const added = isFolderAdded(rec.path);
              const isBusy = addingDetectedId === rec.id || addingAllDetected;
              return (
                <div
                  key={rec.id}
                  data-detected-recorder={rec.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-3 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--text-primary)]">
                      {rec.label}
                    </p>
                    <p className="font-mono-tabular truncate text-[12px] text-[var(--text-secondary)]">
                      {rec.path}
                    </p>
                  </div>

                  {added ? (
                    <span className="inline-flex h-7 items-center gap-1 rounded-[6px] bg-[var(--status-success-bg)] px-2.5 text-[11px] font-semibold text-[var(--status-success-fg)]">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Added
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddDetectedRecorder(rec)}
                      disabled={isBusy}
                      className="btn-secondary h-8 px-3 text-[12px]"
                    >
                      {addingDetectedId === rec.id ? "Adding..." : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {manualAddOpen && (
        <div className="mt-4 flex items-center gap-2 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-3 shadow-[var(--border-card-specular),var(--shadow-card-rest)]">
          <input
            type="text"
            value={newFolderPath}
            onChange={(e) => setNewFolderPath(e.target.value)}
            placeholder="Enter folder path to index clips"
            aria-label="Watch folder path"
            className="glint-input font-mono-tabular h-9 flex-1 rounded-[8px] px-3 text-[12px] focus:border-[var(--accent-primary)] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleManualAddSubmit}
            disabled={!newFolderPath.trim() || addingFolder}
            className="btn-primary h-9 px-3 text-[12px]"
          >
            Add
          </button>
        </div>
      )}

      <div className="mt-5 space-y-2.5">
        {watchFolders.length === 0 ? (
          <div className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-6 text-center shadow-[var(--border-card-specular),var(--shadow-card-rest)]">
            <p className="text-[13px] font-medium text-[var(--text-primary)]">
              No watch folders configured
            </p>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
              Use Scan Recorders or Add Custom Folder to connect any game recorder or local video directory.
            </p>
          </div>
        ) : (
          watchFolders.map((folder) => (
            <div
              key={folder.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-4 shadow-[var(--border-card-specular),var(--shadow-card-rest)]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-900/[0.06] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                    {formatSourceTypeLabel(folder.sourceType)}
                  </span>
                  <span className="font-mono-tabular truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {folder.path}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                  {folder.lastScannedAt
                    ? `Last scanned ${new Date(folder.lastScannedAt).toLocaleString()}`
                    : "Not scanned yet"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label className="inline-flex min-h-[32px] items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={folder.enabled}
                    onChange={(e) => onToggleWatchFolder(folder.id, e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />
                  Enabled
                </label>
                <button
                  type="button"
                  onClick={() => onScanFolder(folder.id)}
                  className="btn-secondary h-8 px-2.5 text-[12px]"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Rescan
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveWatchFolder(folder)}
                  aria-label={`Remove ${folder.path}`}
                  className="btn-icon flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--status-error-bg)] hover:text-[var(--status-error-fg)]"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
