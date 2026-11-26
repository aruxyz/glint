import { useEffect, useState } from "react";
import { FolderOpen, HardDrive, Keyboard, Sliders } from "lucide-react";
import { ExportTab, type EncoderPreference } from "./settings/ExportTab";
import { ShortcutsTab } from "./settings/ShortcutsTab";
import { StorageTab } from "./settings/StorageTab";
import { WatchFoldersTab } from "./settings/WatchFoldersTab";
import type { AppSettings, SourceType, WatchFolder } from "../lib/types";

export type SettingsTab = "folders" | "storage" | "export" | "shortcuts";

const ENCODER_PREF_KEY = "glint.encoderPreference";

interface SettingsViewProps {
  initialTab?: SettingsTab;
  watchFolders: WatchFolder[];
  settings: AppSettings;
  hasNvenc: boolean;
  hasAmf?: boolean;
  hasQsv?: boolean;
  hardwareEncoder?: string | null;
  ffmpegAvailable: boolean;
  onAddWatchFolder: (path: string, sourceType: SourceType) => Promise<void>;
  onToggleWatchFolder: (folderId: string, enabled: boolean) => Promise<void>;
  onRemoveWatchFolder: (folder: WatchFolder) => void;
  onScanFolder: (folderId?: string | null) => Promise<void>;
  onUpdateSettings: (next: AppSettings) => Promise<void>;
  onRunCleanup: (clipIds: string[]) => Promise<void>;
}

export function SettingsView({
  initialTab = "folders",
  watchFolders,
  settings,
  hasNvenc,
  hasAmf = false,
  hasQsv = false,
  hardwareEncoder = null,
  ffmpegAvailable,
  onAddWatchFolder,
  onToggleWatchFolder,
  onRemoveWatchFolder,
  onScanFolder,
  onUpdateSettings,
  onRunCleanup,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [encoderPref, setEncoderPref] = useState<EncoderPreference>(() => {
    try {
      const saved = window.localStorage.getItem(ENCODER_PREF_KEY);
      if (saved === "cpu" || saved === "nvenc") return saved;
    } catch {
      // Ignore storage read failures.
    }
    return "nvenc";
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleEncoderPrefChange = (pref: EncoderPreference) => {
    setEncoderPref(pref);
    try {
      window.localStorage.setItem(ENCODER_PREF_KEY, pref);
    } catch {
      // Ignore storage write failures.
    }
  };

  const handleSaveSettings = async (nextSettings: AppSettings) => {
    setSavingSettings(true);
    setSaveFeedback(null);
    try {
      await onUpdateSettings(nextSettings);
      setSaveFeedback("Settings saved");
      window.setTimeout(() => setSaveFeedback(null), 3000);
    } finally {
      setSavingSettings(false);
    }
  };

  const tabButton = (id: SettingsTab, label: string, Icon: typeof FolderOpen) => {
    const active = activeTab === id;
    return (
      <button
        type="button"
        onClick={() => setActiveTab(id)}
        className={`nav-item-press flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-[13px] ${
          active
            ? "bg-[var(--accent-tint-bg)] font-semibold text-[var(--accent-text)]"
            : "font-medium text-[var(--text-secondary)] hover:bg-slate-900/5 hover:text-[var(--text-primary)]"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <main className="view-enter flex min-w-0 flex-1 overflow-hidden bg-[var(--surface-canvas)]">
      <nav
        aria-label="Settings sections"
        className="glass-chrome w-[216px] shrink-0 border-r border-[var(--border-hairline)] p-4"
      >
        <p className="px-3 text-[12px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">
          Settings
        </p>
        <div className="mt-3 space-y-1">
          {tabButton("folders", "Watch Folders", FolderOpen)}
          {tabButton("storage", "Storage & Cleanup", HardDrive)}
          {tabButton("export", "Export & Hardlinks", Sliders)}
          {tabButton("shortcuts", "Shortcuts", Keyboard)}
        </div>
      </nav>

      <div className="glint-scroll flex-1 overflow-y-auto p-6">
        <div key={activeTab} className="tab-enter mr-auto max-w-[680px]">
          {activeTab === "folders" && (
            <WatchFoldersTab
              watchFolders={watchFolders}
              onAddWatchFolder={onAddWatchFolder}
              onToggleWatchFolder={onToggleWatchFolder}
              onRemoveWatchFolder={onRemoveWatchFolder}
              onScanFolder={onScanFolder}
            />
          )}

          {activeTab === "storage" && (
            <StorageTab
              draft={draft}
              setDraft={setDraft}
              savingSettings={savingSettings}
              saveFeedback={saveFeedback}
              onSaveSettings={handleSaveSettings}
              onRunCleanup={onRunCleanup}
            />
          )}

          {activeTab === "export" && (
            <ExportTab
              draft={draft}
              setDraft={setDraft}
              watchFolders={watchFolders}
              hasNvenc={hasNvenc}
              hasAmf={hasAmf}
              hasQsv={hasQsv}
              hardwareEncoder={hardwareEncoder}
              ffmpegAvailable={ffmpegAvailable}
              encoderPref={encoderPref}
              onEncoderPrefChange={handleEncoderPrefChange}
              savingSettings={savingSettings}
              saveFeedback={saveFeedback}
              onSaveSettings={handleSaveSettings}
            />
          )}

          {activeTab === "shortcuts" && <ShortcutsTab />}
        </div>
      </div>
    </main>
  );
}
