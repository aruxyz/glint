import { useEffect, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  Copy,
  Minus,
  PanelLeft,
  Search,
  Settings,
  Square,
  X,
} from "lucide-react";
import { GlintMark } from "./GlintMark";
import { isTauriRuntime } from "../lib/api";
import type { ScanProgressPayload } from "../lib/types";

interface TitlebarProps {
  contextLabel: string;
  backLabel?: string | null;
  onBack?: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  showSidebarToggle: boolean;
  showWorkspaceTabs?: boolean;
  settingsOpen: boolean;
  editorMode: boolean;
  editorSegmentCount: number;
  onSelectClipsMode: () => void;
  onSelectEditorMode: () => void;
  onToggleSettings: () => void;
  scanProgress: ScanProgressPayload | null;
}

export function Titlebar({
  contextLabel,
  backLabel,
  onBack,
  searchQuery,
  onSearchChange,
  searchInputRef,
  sidebarOpen,
  onToggleSidebar,
  showSidebarToggle,
  showWorkspaceTabs = true,
  settingsOpen,
  editorMode,
  editorSegmentCount,
  onSelectClipsMode,
  onSelectEditorMode,
  onToggleSettings,
  scanProgress,
}: TitlebarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const inTauri = isTauriRuntime();

  useEffect(() => {
    if (!inTauri) return;
    const win = getCurrentWindow();
    let mounted = true;
    win.isMaximized().then((val) => {
      if (mounted) setIsMaximized(val);
    }).catch(() => {});

    let unlisten: (() => void) | undefined;
    win
      .onResized(() => {
        win.isMaximized().then((val) => {
          if (mounted) setIsMaximized(val);
        }).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [inTauri]);

  const handleMinimize = () => {
    if (!inTauri) return;
    getCurrentWindow().minimize().catch(() => {});
  };

  const handleToggleMaximize = () => {
    if (!inTauri) return;
    const win = getCurrentWindow();
    win.toggleMaximize()
      .then(() => win.isMaximized())
      .then((val) => setIsMaximized(val))
      .catch(() => {});
  };

  const handleClose = () => {
    if (!inTauri) return;
    getCurrentWindow().close().catch(() => {});
  };

  const clipsTabActive = !editorMode && !settingsOpen;
  const editorTabActive = editorMode && !settingsOpen;

  return (
    <header
      data-tauri-drag-region
      className="glass-chrome relative z-40 flex h-9 shrink-0 items-center justify-between border-b border-[var(--border-hairline)] select-none"
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-1.5 pl-2">
        {showSidebarToggle && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Collapse sidebar (Ctrl+B)" : "Expand sidebar (Ctrl+B)"}
            aria-expanded={sidebarOpen}
            title="Toggle sidebar (Ctrl+B)"
            className={`btn-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)] ${
              sidebarOpen
                ? "bg-slate-900/[0.04] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            <PanelLeft
              className={`h-4 w-4 transition-transform duration-[180ms] ease-[var(--ease-fluent)] ${
                sidebarOpen ? "translate-x-0 scale-x-100" : "-translate-x-[1px] scale-x-[0.94]"
              }`}
              aria-hidden="true"
            />
          </button>
        )}

        <div data-tauri-drag-region className="flex shrink-0 items-center gap-2 px-1.5">
          <GlintMark className="h-4 w-4 shrink-0 text-[var(--text-primary)]" />
          <span className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">
            Glint
          </span>
        </div>

        {showWorkspaceTabs && (
          <div
            role="tablist"
            aria-label="Workspace mode"
            className="ml-1 inline-flex h-[26px] shrink-0 items-center rounded-[7px] border border-[var(--border-hairline)] bg-slate-900/[0.06] p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={clipsTabActive}
              onClick={onSelectClipsMode}
              className={`nav-item-press inline-flex h-[20px] items-center rounded-[5px] px-2.5 text-[12px] ${
                clipsTabActive
                  ? "bg-[var(--surface-control-hover)] font-semibold text-[var(--text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                  : "font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Clips
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={editorTabActive}
              onClick={onSelectEditorMode}
              title="Switch to Editor Mode (Ctrl+E)"
              className={`nav-item-press inline-flex h-[20px] items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] ${
                editorTabActive
                  ? "bg-[var(--surface-control-hover)] font-semibold text-[var(--text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                  : "font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>Editor</span>
              {editorSegmentCount > 0 && (
                <span
                  data-testid="titlebar-editor-badge"
                  className="font-mono-tabular inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[10px] leading-none font-semibold text-white"
                >
                  {editorSegmentCount > 99 ? "99+" : editorSegmentCount}
                </span>
              )}
            </button>
          </div>
        )}

        <span className="hidden text-slate-400 md:inline" aria-hidden="true">
          /
        </span>

        {backLabel && onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="nav-item-press hidden max-w-[140px] items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-slate-900/5 hover:text-[var(--text-primary)] md:inline-flex lg:max-w-[200px]"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{backLabel}</span>
          </button>
        ) : (
          <span
            data-tauri-drag-region
            className="hidden max-w-[120px] truncate px-1 text-[12px] font-medium text-[var(--text-secondary)] md:inline lg:max-w-[180px]"
          >
            {contextLabel}
          </span>
        )}
      </div>

      <div
        data-tauri-drag-region
        className="mx-2 flex min-w-0 flex-1 items-center justify-center lg:mx-3"
      >
        <div className="relative w-full min-w-[140px] max-w-[280px] xl:max-w-[360px]">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search clips..."
            aria-label="Search clips"
            className="glint-input h-[26px] w-full rounded-[6px] pr-14 pl-8 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="btn-icon absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-[var(--text-muted)] hover:bg-slate-200/70 hover:text-[var(--text-primary)]"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : (
            <kbd className="pointer-events-none font-mono-tabular absolute top-1/2 right-2 -translate-y-1/2 rounded-[4px] border border-[var(--border-hairline)] bg-white/75 px-1.5 py-0.5 text-[10px] leading-none font-medium text-[var(--text-secondary)]">
              Ctrl+K
            </kbd>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        {scanProgress && !scanProgress.done && (
          <div
            className="mr-2 hidden items-center gap-1.5 rounded-md bg-[var(--surface-control)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] ring-1 ring-slate-900/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] xl:flex"
            aria-live="polite"
          >
            <span className="font-mono-tabular">
              Scanning {scanProgress.scanned}/{scanProgress.total || "?"}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleSettings}
          aria-label={settingsOpen ? "Close Settings (Ctrl+,)" : "Open Settings (Ctrl+,)"}
          aria-pressed={settingsOpen}
          title="Settings (Ctrl+,)"
          className={`btn-icon flex h-9 w-9 items-center justify-center ${
            settingsOpen
              ? "bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
              : "text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
          }`}
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="flex items-center">
          <button
            type="button"
            onClick={handleMinimize}
            disabled={!inTauri}
            aria-label="Minimize window"
            title={inTauri ? "Minimize" : "Desktop window control"}
            className="btn-window-caption flex h-9 w-[46px] items-center justify-center text-[var(--text-primary)] hover:bg-slate-900/[0.06] disabled:opacity-45"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            disabled={!inTauri}
            aria-label={isMaximized ? "Restore window" : "Maximize window"}
            title={inTauri ? (isMaximized ? "Restore" : "Maximize") : "Desktop window control"}
            className="btn-window-caption flex h-9 w-[46px] items-center justify-center text-[var(--text-primary)] hover:bg-slate-900/[0.06] disabled:opacity-45"
          >
            {isMaximized ? (
              <Copy className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Square className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={!inTauri}
            aria-label="Close window"
            title={inTauri ? "Close" : "Desktop window control"}
            className="btn-window-caption flex h-9 w-[46px] items-center justify-center text-[var(--text-primary)] hover:bg-[#C42B1C] hover:text-white disabled:opacity-45"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
