import { useCallback, useEffect, useRef, useState } from "react";
import { AppModalsLayer } from "./components/AppModalsLayer";
import { BatchExportModal } from "./components/library/BatchExportModal";
import { UpdateModal } from "./components/UpdateModal";
import { useAutoUpdater } from "./hooks/useAutoUpdater";
import { EditorView } from "./components/EditorView";
import { LibraryView } from "./components/LibraryView";
import { OnboardingView } from "./components/OnboardingView";
import { PlayerView } from "./components/PlayerView";
import { SettingsView, type SettingsTab } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import { useAppModals } from "./hooks/useAppModals";
import { useClipActions } from "./hooks/useClipActions";
import { useEditorWorkspace } from "./hooks/useEditorWorkspace";
import { useExportJobs } from "./hooks/useExportJobs";
import { useLibrary } from "./hooks/useLibrary";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { api, isTauriRuntime } from "./lib/api";
import { DEFAULT_SETTINGS, getEncoderLabel } from "./lib/encoder";
import type {
  ClipSummary,
  CustomExportPreset,
  CustomPresetInput,
  NavDestination,
  SourceType,
  WatchFolder,
} from "./lib/types";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("folders");

  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1160 : false
  );
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1160 : true
  );

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarBeforeEditorRef = useRef<boolean | null>(null);
  const [playerTrimByClipId, setPlayerTrimByClipId] = useState<
    Record<string, { startSec: number; endSec: number }>
  >({});
  const [customPresets, setCustomPresets] = useState<CustomExportPreset[]>([]);
  const [batchExportClips, setBatchExportClips] = useState<ClipSummary[] | null>(null);

  useEffect(() => {
    api
      .listCustomPresets()
      .then(setCustomPresets)
      .catch(() => {});
  }, []);

  const handleCreateCustomPreset = useCallback(async (input: CustomPresetInput) => {
    const created = await api.createCustomPreset(input);
    setCustomPresets((prev) => [...prev, created]);
  }, []);

  const handleUpdateCustomPreset = useCallback(
    async (id: string, input: CustomPresetInput) => {
      const updated = await api.updateCustomPreset(id, input);
      setCustomPresets((prev) => prev.map((p) => (p.id === id ? updated : p)));
    },
    []
  );

  const handleDeleteCustomPreset = useCallback(async (id: string) => {
    await api.deleteCustomPreset(id);
    setCustomPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleSavePlayerTrim = useCallback(
    (clipId: string, startSec: number, endSec: number) => {
      setPlayerTrimByClipId((prev) => {
        const existing = prev[clipId];
        if (existing && existing.startSec === startSec && existing.endSec === endSec) {
          return prev;
        }
        return { ...prev, [clipId]: { startSec, endSec } };
      });
    },
    []
  );

  const library = useLibrary(settingsOpen);
  const modals = useAppModals();
  const editor = useEditorWorkspace();
  const updater = useAutoUpdater();

  const {
    bootstrapped,
    bootstrap,
    showOnboarding,
    setOnboardingDismissed,
    games,
    tags,
    collections,
    destination,
    setDestination,
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    favoritesOnly,
    setFavoritesOnly,
    durationPreset,
    setDurationPreset,
    sortBy,
    setSortBy,
    clips,
    setClips,
    totalCount,
    totalSizeBytes,
    clipsLoading,
    loadingMore,
    clipsError,
    selectedIds,
    setSelectedIds,
    setLastSelectedId,
    selectMode,
    setSelectMode,
    activeClip,
    setActiveClip,
    playerQueue,
    setPlayerQueue,
    contextLabel,
    refreshMetadata,
    loadClips,
    loadMoreClips,
    clearSelection,
    handleToggleSelectClip,
    handleToggleFavorite,
  } = library;

  const currentSettings = bootstrap?.settings ?? DEFAULT_SETTINGS;

  const exports = useExportJobs({
    bootstrap,
    currentSettings,
    clips,
    setClips,
    setPlayerQueue,
    setActiveClip,
    clearSelection,
    closeMergeModal: modals.closeMergeModal,
  });

  const { scanProgress, scanning, setScanning } = useTauriEvents({
    bootstrap,
    activeExportMetaRef: exports.activeExportMetaRef,
    refreshMetadata,
    loadClips,
    setToast: exports.setToast,
  });

  const actions = useClipActions({
    currentSettings,
    destination,
    clips,
    totalCount,
    activeClip,
    playerQueue,
    selectedIds,
    setOnboardingDismissed,
    setScanning,
    setDestination,
    setActiveClip,
    setPlayerQueue,
    setSelectedIds,
    setConfirmState: modals.setConfirmState,
    setMergeModal: modals.setMergeModal,
    setMergeError: exports.setMergeError,
    setToast: exports.setToast,
    clearSelection,
    refreshMetadata,
    loadClips,
  });

  useEffect(() => {
    document.documentElement.dataset.runtime = isTauriRuntime() ? "tauri" : "browser";
  }, []);

  // Disable native WebView2/Chromium context menu outside editable text inputs.
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable = Boolean(
        target &&
          (target.closest('input, textarea, [contenteditable="true"]') ||
            target.isContentEditable)
      );
      if (!isEditable) {
        e.preventDefault();
      }
    };
    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => window.removeEventListener("contextmenu", handleGlobalContextMenu);
  }, []);

  useEffect(() => {
    let wasCompact = window.innerWidth < 1160;
    const handleResize = () => {
      const compact = window.innerWidth < 1160;
      setIsCompactViewport(compact);
      if (compact !== wasCompact) {
        setSidebarOpen(!compact);
        wasCompact = compact;
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Global keyboard shortcuts (Ctrl+K, Ctrl+B, Ctrl+,).
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (key === "b") {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      } else if (key === "e") {
        e.preventDefault();
        if (editor.editorMode && !settingsOpen) {
          exitEditorMode();
        } else {
          enterEditorMode();
        }
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  });

  const enterEditorMode = () => {
    modals.setContextMenu(null);
    clearSelection();
    setSettingsOpen(false);
    if (!editor.editorMode) {
      sidebarBeforeEditorRef.current = sidebarOpen;
      setSidebarOpen(false);
      editor.setEditorMode(true);
    }
  };

  const exitEditorMode = () => {
    modals.setContextMenu(null);
    clearSelection();
    setSettingsOpen(false);
    if (editor.editorMode) {
      editor.setEditorMode(false);
      if (!isCompactViewport && sidebarBeforeEditorRef.current !== null) {
        setSidebarOpen(sidebarBeforeEditorRef.current);
      }
      sidebarBeforeEditorRef.current = null;
    }
  };

  const handleSelectDestination = (dest: NavDestination) => {
    setDestination(dest);
    clearSelection();
    modals.setContextMenu(null);
    setSettingsOpen(false);
    editor.setEditorMode(false);
    sidebarBeforeEditorRef.current = null;
    setActiveClip(null);
  };

  if (!bootstrapped) {
    return (
      <div className="flex h-[100dvh] flex-col bg-[var(--surface-canvas)]">
        <Titlebar
          contextLabel="Starting..."
          searchQuery=""
          onSearchChange={() => {}}
          searchInputRef={searchInputRef}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
          showSidebarToggle={false}
          showWorkspaceTabs={false}
          settingsOpen={false}
          editorMode={false}
          editorSegmentCount={0}
          onSelectClipsMode={() => {}}
          onSelectEditorMode={() => {}}
          onToggleSettings={() => {}}
          scanProgress={null}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="glass-dock rounded-[12px] px-5 py-3 text-[13px] font-medium text-[var(--text-secondary)]">
            Loading Glint library...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-transparent text-[var(--text-primary)]">
      <Titlebar
        contextLabel={editor.editorMode && !settingsOpen ? "Editor" : contextLabel}
        backLabel={
          settingsOpen
            ? editor.editorMode
              ? "Back to Editor"
              : "Back to Library"
            : editor.editorMode
              ? activeClip
                ? "Back to Player"
                : `Back to ${contextLabel}`
              : activeClip
                ? `Back to ${contextLabel}`
                : null
        }
        onBack={() => {
          if (settingsOpen) setSettingsOpen(false);
          else if (editor.editorMode) exitEditorMode();
          else if (activeClip) setActiveClip(null);
        }}
        searchQuery={searchQuery}
        onSearchChange={(val) => {
          setSearchQuery(val);
          if (activeClip) setActiveClip(null);
          if (editor.editorMode) exitEditorMode();
          if (settingsOpen) setSettingsOpen(false);
        }}
        searchInputRef={searchInputRef}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        showSidebarToggle={!showOnboarding && !settingsOpen}
        showWorkspaceTabs={!showOnboarding}
        settingsOpen={settingsOpen}
        editorMode={editor.editorMode}
        editorSegmentCount={editor.editorSegments.length}
        onSelectClipsMode={exitEditorMode}
        onSelectEditorMode={enterEditorMode}
        onToggleSettings={() => {
          setSettingsTab("folders");
          clearSelection();
          modals.setContextMenu(null);
          setSettingsOpen((prev) => !prev);
        }}
        scanProgress={scanProgress}
      />

      {showOnboarding ? (
        <OnboardingView
          initialHardlinkDir={currentSettings.hardlinkBaseDir}
          onComplete={actions.handleOnboardingComplete}
          onSkip={() => setOnboardingDismissed(true)}
        />
      ) : settingsOpen ? (
        <SettingsView
          initialTab={settingsTab}
          watchFolders={bootstrap?.watchFolders ?? []}
          settings={currentSettings}
          hasNvenc={Boolean(bootstrap?.hasNvenc)}
          hasAmf={Boolean(bootstrap?.hasAmf)}
          hasQsv={Boolean(bootstrap?.hasQsv)}
          hardwareEncoder={bootstrap?.hardwareEncoder ?? null}
          ffmpegAvailable={Boolean(bootstrap?.ffmpegAvailable)}
          customPresets={customPresets}
          onCreateCustomPreset={handleCreateCustomPreset}
          onUpdateCustomPreset={handleUpdateCustomPreset}
          onDeleteCustomPreset={handleDeleteCustomPreset}
          onAddWatchFolder={async (path: string, sourceType: SourceType) => {
            await api.addWatchFolder(path, sourceType);
            await api.scanWatchFolders(null).catch(() => {});
            await refreshMetadata();
            await loadClips();
          }}
          onToggleWatchFolder={async (folderId, enabled) => {
            await api.toggleWatchFolder(folderId, enabled);
            await refreshMetadata();
          }}
          onRemoveWatchFolder={(folder: WatchFolder) => {
            modals.setConfirmState({
              open: true,
              title: "Remove watch folder?",
              description: `Glint will stop indexing "${folder.path}". Original video files on disk are not deleted.`,
              confirmLabel: "Remove Folder",
              destructive: true,
              onConfirm: async () => {
                await api.removeWatchFolder(folder.id);
                await refreshMetadata();
                await loadClips();
              },
            });
          }}
          onScanFolder={actions.handleScanNow}
          onUpdateSettings={async (next) => {
            await api.updateSettings(next);
            await refreshMetadata();
          }}
          onRunCleanup={async (clipIds) => {
            const res = await api.runStorageCleanup(clipIds);
            await refreshMetadata();
            await loadClips();
            exports.setToast({
              kind: "info",
              title: "Storage cleanup complete",
              detail: `${res.removedCount} clips moved to Recycle Bin`,
            });
          }}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            open={sidebarOpen}
            isCompactViewport={isCompactViewport}
            onCloseCompact={() => setSidebarOpen(false)}
            destination={destination}
            onSelectDestination={handleSelectDestination}
            stats={
              bootstrap?.stats ?? {
                totalClips: 0,
                totalFavorites: 0,
                totalSizeBytes: 0,
                gamesCount: 0,
              }
            }
            games={games}
            collections={collections}
            maxStorageGb={currentSettings.maxStorageGb}
            onCreateCollection={() =>
              modals.setCollectionModal({ open: true, mode: "create" })
            }
            onOpenStorageSettings={() => {
              setSettingsTab("storage");
              setSettingsOpen(true);
            }}
            onOpenAsRealFolder={exports.handleOpenAsRealFolder}
            onMergeCollection={actions.handleOpenMergeCollection}
            onRenameCollection={(col) =>
              modals.setCollectionModal({ open: true, mode: "rename", target: col })
            }
            onDeleteCollection={actions.handleDeleteCollectionConfirm}
            onOpenContextMenu={modals.openContextMenu}
          />

          {editor.editorMode ? (
            <EditorView
              segments={editor.editorSegments}
              audioLayers={editor.audioLayers}
              selectedAudioLayerId={editor.selectedAudioLayerId}
              exportOptions={editor.exportOptions}
              activeProjectId={editor.activeProjectId}
              activeProjectName={editor.activeProjectName}
              activeProjectUpdatedAt={editor.activeProjectUpdatedAt}
              isDirty={editor.isDirty}
              selectedSegmentIds={editor.selectedSegmentIds}
              primarySelectedSegmentId={editor.primarySelectedSegmentId}
              canUndo={editor.canUndo}
              canRedo={editor.canRedo}
              libraryClips={clips}
              streamerBaseUrl={bootstrap?.streamerBaseUrl ?? ""}
              streamerToken={bootstrap?.streamerToken ?? ""}
              encoderInfo={{
                hasNvenc: Boolean(bootstrap?.hasNvenc),
                hasAmf: Boolean(bootstrap?.hasAmf),
                hasQsv: Boolean(bootstrap?.hasQsv),
                hardwareEncoder: bootstrap?.hardwareEncoder,
              }}
              onChangeExportOptions={editor.setExportOptions}
              onSaveCurrentProject={editor.saveCurrentProject}
              onSaveProjectWithName={editor.saveProjectWithName}
              onOpenLoadedProject={editor.openLoadedProject}
              onStartNewProject={editor.startNewProject}
              onUnlinkActiveProject={editor.unlinkActiveProject}
              onSelectSegment={editor.selectSegment}
              onToggleSelectSegment={editor.toggleSelectSegment}
              onSelectRangeSegments={editor.selectRangeSegments}
              onSelectAllSegments={editor.selectAllSegments}
              onClearSegmentSelection={editor.clearSegmentSelection}
              onSelectAudioLayer={editor.selectAudioLayer}
              onAddAudioLayer={editor.addAudioLayer}
              onUpdateAudioLayer={editor.updateAudioLayer}
              onRemoveAudioLayer={editor.removeAudioLayer}
              onAddClipsFromLibrary={editor.addClipsFromLibrary}
              onUpdateSegment={editor.updateSegment}
              onUpdateSegments={editor.updateSegments}
              onSplitSegment={editor.splitSegment}
              onBeginHistoryTransaction={editor.beginHistoryTransaction}
              onCommitHistoryTransaction={editor.commitHistoryTransaction}
              onUndo={editor.undo}
              onRedo={editor.redo}
              onMoveSegment={editor.moveSegment}
              onReorderSegment={editor.reorderSegment}
              onDuplicateSegment={editor.duplicateSegment}
              onRemoveSegment={editor.removeSegment}
              onRemoveSegments={editor.removeSegments}
              onClearSegments={editor.clearSegments}
              onRequestConfirmClear={(count, onConfirm) =>
                modals.setConfirmState({
                  open: true,
                  title: "Clear all editor segments?",
                  description: `Remove all ${count} segments from the timeline? Original clips in your library are untouched.`,
                  confirmLabel: "Clear Timeline",
                  destructive: true,
                  onConfirm: async () => {
                    onConfirm();
                  },
                })
              }
              onRequestConfirmRemoveSelected={(count, onConfirm) =>
                modals.setConfirmState({
                  open: true,
                  title: `Remove ${count} selected segments?`,
                  description: `Remove ${count} selected segments from the timeline? Original clips in your library are untouched.`,
                  confirmLabel: "Remove Selected",
                  destructive: true,
                  onConfirm: async () => {
                    onConfirm();
                  },
                })
              }
              onStartEditorExport={exports.handleStartEditorExport}
            />
          ) : activeClip ? (
            <PlayerView
              clip={activeClip}
              queue={playerQueue.length > 0 ? playerQueue : clips}
              sourceLabel={contextLabel}
              streamerBaseUrl={bootstrap?.streamerBaseUrl ?? ""}
              streamerToken={bootstrap?.streamerToken ?? ""}
              defaultAutoNext={currentSettings.defaultAutoNext}
              autoCopyToClipboard={currentSettings.autoCopyExportToClipboard}
              customPresets={customPresets}
              onOpenExportSettings={() => {
                setSettingsTab("export");
                setSettingsOpen(true);
              }}
              savedTrim={playerTrimByClipId[activeClip.id] ?? null}
              onSaveTrimRange={handleSavePlayerTrim}
              onBack={() => setActiveClip(null)}
              onSelectClip={(c) => setActiveClip(c)}
              onToggleFavorite={handleToggleFavorite}
              onOpenCollectionPicker={(c) =>
                modals.setCollectionPickerClipIds([c.id])
              }
              onEditClip={(c) => modals.setEditClipTarget(c)}
              onCopyClipFile={actions.handleCopyClipFile}
              onRevealFile={actions.handleRevealFile}
              onDeleteClip={actions.handleDeleteClip}
              onOpenContextMenu={modals.openContextMenu}
              onSetCover={exports.handleSetClipCover}
              onSnapshotFrame={exports.handleSnapshotFrame}
              onOpenSaveTrimModal={({
                clip,
                startSec,
                endSec,
                audioMix,
                aspectMode,
                normalizeAudio,
              }) => {
                modals.setSaveTrimError(null);
                modals.setSaveTrimModal({
                  open: true,
                  clip,
                  startSec,
                  endSec,
                  audioMix,
                  aspectMode,
                  normalizeAudio,
                });
              }}
              onSendToEditor={({
                clip: sentClip,
                startSec,
                endSec,
                audioMix,
                masterVolume,
                masterMuted,
              }) => {
                const nextCount = editor.editorSegments.length + 1;
                editor.addSegmentFromPlayer({
                  clip: sentClip,
                  startSec,
                  endSec,
                  audioMix,
                  masterVolume,
                  masterMuted,
                });
                exports.setToast({
                  kind: "editor_segment_added",
                  clipTitle: sentClip.title?.trim() || sentClip.fileName,
                  durationSec: Math.max(0.25, endSec - startSec),
                  segmentCount: nextCount,
                });
              }}
              onStartExport={exports.handleStartExport}
            />
          ) : (
            <LibraryView
              destination={destination}
              games={games}
              collections={collections}
              watchFolders={bootstrap?.watchFolders ?? []}
              clips={clips}
              totalCount={totalCount}
              totalSizeBytes={totalSizeBytes}
              loading={clipsLoading}
              loadingMore={loadingMore}
              hasMore={clips.length < totalCount}
              onLoadMore={loadMoreClips}
              scanning={scanning}
              error={clipsError}
              searchQuery={searchQuery}
              selectedTags={selectedTags}
              onSelectedTagsChange={setSelectedTags}
              favoritesOnly={favoritesOnly}
              onFavoritesOnlyChange={setFavoritesOnly}
              durationPreset={durationPreset}
              onDurationPresetChange={setDurationPreset}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              onClearFilters={() => {
                setSearchQuery("");
                setSelectedTags([]);
                setFavoritesOnly(false);
                setDurationPreset("any");
              }}
              tags={tags}
              streamerBaseUrl={bootstrap?.streamerBaseUrl ?? ""}
              streamerToken={bootstrap?.streamerToken ?? ""}
              linkingCollectionId={exports.linkingCollectionId}
              selectedIds={selectedIds}
              selectMode={selectMode}
              onToggleSelectMode={() => {
                if (selectMode || selectedIds.size > 0) {
                  clearSelection();
                } else {
                  setSelectMode(true);
                }
              }}
              onToggleSelectClip={handleToggleSelectClip}
              onSelectAll={(orderedClips) => {
                setSelectedIds(new Set(orderedClips.map((c) => c.id)));
                if (orderedClips.length > 0) {
                  setLastSelectedId(orderedClips[orderedClips.length - 1].id);
                }
              }}
              onClearSelection={clearSelection}
              onBulkAddToCollection={() =>
                modals.setCollectionPickerClipIds(Array.from(selectedIds))
              }
              onBulkRemoveFromCollection={actions.handleBulkRemoveFromCollection}
              onBulkBatchExport={() => {
                const selected = clips.filter((c) => selectedIds.has(c.id));
                if (selected.length > 0) setBatchExportClips(selected);
              }}
              onBulkMerge={actions.handleOpenBulkMerge}
              onBulkDelete={actions.handleBulkDelete}
              onOpenPlayer={(c) => {
                clearSelection();
                setPlayerQueue(clips);
                setActiveClip(c);
              }}
              onPlayAll={(queue) => {
                if (queue.length > 0) {
                  clearSelection();
                  setPlayerQueue(queue);
                  setActiveClip(queue[0]);
                }
              }}
              onOpenAsRealFolder={exports.handleOpenAsRealFolder}
              onMergeCollection={actions.handleOpenMergeCollection}
              onScanNow={() => actions.handleScanNow(null)}
              onRetryLoad={loadClips}
              onOpenAddWatchFolder={() => setOnboardingDismissed(false)}
              onOpenSettingsFolders={() => {
                setSettingsTab("folders");
                setSettingsOpen(true);
              }}
              onBrowseAllClips={() => handleSelectDestination({ kind: "all" })}
              onRenameCollection={(col) =>
                modals.setCollectionModal({ open: true, mode: "rename", target: col })
              }
              onDeleteCollection={actions.handleDeleteCollectionConfirm}
              onToggleFavorite={handleToggleFavorite}
              onOpenCollectionPicker={(c) =>
                modals.setCollectionPickerClipIds([c.id])
              }
              onRemoveClipFromCollection={actions.handleRemoveSingleFromCollection}
              onEditClip={(c) => modals.setEditClipTarget(c)}
              onCopyClipFile={actions.handleCopyClipFile}
              onRevealFile={actions.handleRevealFile}
              onDeleteClip={actions.handleDeleteClip}
              onOpenContextMenu={modals.openContextMenu}
            />
          )}
        </div>
      )}

      <AppModalsLayer
        bootstrap={bootstrap}
        currentSettings={currentSettings}
        collections={collections}
        tags={tags}
        activeClip={activeClip}
        setActiveClip={setActiveClip}
        setClips={setClips}
        setPlayerQueue={setPlayerQueue}
        setDestination={setDestination}
        setSettingsOpen={setSettingsOpen}
        setSettingsTab={setSettingsTab}
        refreshMetadata={refreshMetadata}
        loadClips={loadClips}
        contextMenu={modals.contextMenu}
        setContextMenu={modals.setContextMenu}
        collectionModal={modals.collectionModal}
        setCollectionModal={modals.setCollectionModal}
        collectionPickerClipIds={modals.collectionPickerClipIds}
        setCollectionPickerClipIds={modals.setCollectionPickerClipIds}
        saveTrimModal={modals.saveTrimModal}
        setSaveTrimModal={modals.setSaveTrimModal}
        savingTrim={modals.savingTrim}
        setSavingTrim={modals.setSavingTrim}
        saveTrimError={modals.saveTrimError}
        setSaveTrimError={modals.setSaveTrimError}
        mergeModal={modals.mergeModal}
        closeMergeModal={modals.closeMergeModal}
        mergingClips={exports.mergingClips}
        mergeError={exports.mergeError}
        onMergeSubmit={exports.handleMergeClipsSubmit}
        editClipTarget={modals.editClipTarget}
        setEditClipTarget={modals.setEditClipTarget}
        confirmState={modals.confirmState}
        setConfirmState={modals.setConfirmState}
        modalBusy={modals.modalBusy}
        setModalBusy={modals.setModalBusy}
        toast={exports.toast}
        setToast={exports.setToast}
        onCancelExport={exports.handleCancelExport}
        onCopyAgain={exports.handleCopyAgain}
        onShowInFolder={exports.handleShowInFolder}
        onRetryExport25Mb={exports.handleRetryExport25Mb}
        onOpenEditor={enterEditorMode}
      />

      <BatchExportModal
        open={batchExportClips !== null}
        clips={batchExportClips ?? []}
        customPresets={customPresets}
        exportOutputDir={currentSettings.exportOutputDir}
        encoderLabel={getEncoderLabel(
          "discord_10mb",
          {
            hasNvenc: Boolean(bootstrap?.hasNvenc),
            hasAmf: Boolean(bootstrap?.hasAmf),
            hasQsv: Boolean(bootstrap?.hasQsv),
            hardwareEncoder: bootstrap?.hardwareEncoder,
          },
          "original",
          false
        )}
        streamerBaseUrl={bootstrap?.streamerBaseUrl ?? ""}
        streamerToken={bootstrap?.streamerToken ?? ""}
        onClose={() => setBatchExportClips(null)}
        onOpenExportSettings={() => {
          setSettingsTab("export");
          setSettingsOpen(true);
        }}
      />

      <UpdateModal
        update={updater.update}
        installing={updater.installing}
        progressPercent={updater.progressPercent}
        error={updater.error}
        onUpdateNow={() => void updater.installUpdate()}
        onLater={updater.dismissUpdate}
      />
    </div>
  );
}
