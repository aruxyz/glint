import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import type { AppSettings, StorageCleanupPreview } from "../../lib/types";

interface StorageTabProps {
  draft: AppSettings;
  setDraft: Dispatch<SetStateAction<AppSettings>>;
  savingSettings: boolean;
  saveFeedback: string | null;
  onSaveSettings: (nextSettings: AppSettings) => Promise<void>;
  onRunCleanup: (clipIds: string[]) => Promise<void>;
}

export function StorageTab({
  draft,
  setDraft,
  savingSettings,
  saveFeedback,
  onSaveSettings,
  onRunCleanup,
}: StorageTabProps) {
  const [preview, setPreview] = useState<StorageCleanupPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);

  const loadCleanupPreview = useCallback(async (maxGb: number) => {
    setLoadingPreview(true);
    try {
      const res = await api.getStorageCleanupPreview(maxGb);
      setPreview(res);
    } catch {
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    if (draft.maxStorageGb > 0) {
      void loadCleanupPreview(draft.maxStorageGb);
    } else {
      setPreview(null);
    }
  }, [draft.maxStorageGb, loadCleanupPreview]);

  const handleConfirmCleanup = async () => {
    if (!preview || preview.candidates.length === 0 || runningCleanup) return;
    setRunningCleanup(true);
    try {
      await onRunCleanup(preview.candidates.map((c) => c.id));
      await loadCleanupPreview(draft.maxStorageGb);
    } finally {
      setRunningCleanup(false);
    }
  };

  return (
    <section aria-labelledby="settings-storage-heading">
      <h1
        id="settings-storage-heading"
        className="text-[18px] font-semibold text-[var(--text-primary)]"
      >
        Storage & Auto-Cleanup
      </h1>
      <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
        Set a target ceiling for watched clip folders. Cleanup moves older unprotected clips to the Windows Recycle Bin.
      </p>

      <div className="mt-5 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-5 shadow-[var(--border-card-specular),var(--shadow-card-rest)]">
        <label className="-mx-2 flex min-h-[40px] items-center gap-2.5 rounded-[8px] px-2 transition-colors hover:bg-slate-900/5">
          <input
            type="checkbox"
            checked={draft.maxStorageGb > 0}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                maxStorageGb: e.target.checked ? 100 : 0,
              }))
            }
            className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
          />
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            Enable storage quota limit
          </span>
        </label>

        {draft.maxStorageGb > 0 && (
          <div className="mt-3 space-y-3 border-t border-[var(--border-hairline)] pt-4">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="storage-limit-gb"
                className="text-[13px] font-medium text-[var(--text-secondary)]"
              >
                Quota limit (GB)
              </label>
              <input
                id="storage-limit-gb"
                type="number"
                min={10}
                max={4000}
                value={draft.maxStorageGb}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    maxStorageGb: Math.max(10, Number(e.target.value) || 10),
                  }))
                }
                className="glint-input font-mono-tabular h-9 w-24 rounded-[8px] px-2.5 text-right text-[13px] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
            <input
              type="range"
              aria-label="Storage quota slider"
              min={20}
              max={1000}
              step={10}
              value={Math.min(1000, draft.maxStorageGb)}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  maxStorageGb: Number(e.target.value),
                }))
              }
              className="h-1.5 w-full accent-[var(--accent-primary)]"
            />
          </div>
        )}

        <div className="mt-3 rounded-[8px] bg-slate-900/[0.04] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
          Favorites and clips inside Collections are protected.
        </div>

        {draft.maxStorageGb > 0 && (
          <div className="mt-4 border-t border-[var(--border-hairline)] pt-4">
            {loadingPreview ? (
              <p className="text-[12px] text-[var(--text-muted)]">
                Checking reclaimable clips...
              </p>
            ) : preview && preview.candidates.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono-tabular text-[12px] font-medium text-[var(--status-warning-fg)]">
                  {preview.candidates.length} oldest unprotected clips (
                  {formatBytes(preview.reclaimableBytes)}) would be moved to Recycle Bin.
                </p>
                <button
                  type="button"
                  onClick={handleConfirmCleanup}
                  disabled={runningCleanup}
                  className="btn-secondary h-8 px-3 text-[12px] text-[var(--status-error-fg)]"
                >
                  {runningCleanup ? "Cleaning..." : "Run Cleanup Now"}
                </button>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--status-success-fg)]">
                Current usage is within your {draft.maxStorageGb} GB quota.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
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
            {savingSettings ? "Saving..." : "Save Storage Settings"}
          </button>
        </div>
      </div>
    </section>
  );
}
