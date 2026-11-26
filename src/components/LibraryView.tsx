import { useMemo, useRef } from "react";
import {
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Pencil,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import type { ContextMenuEntry } from "./ContextMenu";
import { BulkActionBar } from "./library/BulkActionBar";
import { LibraryGrid } from "./library/LibraryGrid";
import { LibraryToolbar } from "./library/LibraryToolbar";
import { formatBytes } from "../lib/format";
import type {
  ClipSortBy,
  ClipSummary,
  CollectionSummary,
  DurationFilterPreset,
  GameSummary,
  NavDestination,
  TagItem,
  WatchFolder,
} from "../lib/types";

interface LibraryViewProps {
  destination: NavDestination;
  games: GameSummary[];
  collections: CollectionSummary[];
  watchFolders: WatchFolder[];
  clips: ClipSummary[];
  totalCount: number;
  totalSizeBytes: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  scanning: boolean;
  error: string | null;
  searchQuery: string;
  selectedTags: string[];
  onSelectedTagsChange: (tags: string[]) => void;
  favoritesOnly: boolean;
  onFavoritesOnlyChange: (value: boolean) => void;
  durationPreset: DurationFilterPreset;
  onDurationPresetChange: (preset: DurationFilterPreset) => void;
  sortBy: ClipSortBy;
  onSortByChange: (sortBy: ClipSortBy) => void;
  onClearFilters: () => void;
  tags: TagItem[];
  streamerBaseUrl: string;
  streamerToken: string;
  linkingCollectionId: string | null;
  selectedIds: Set<string>;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  onToggleSelectClip: (
    clip: ClipSummary,
    shiftKey: boolean,
    orderedClips: ClipSummary[]
  ) => void;
  onSelectAll: (orderedClips: ClipSummary[]) => void;
  onClearSelection: () => void;
  onBulkAddToCollection: () => void;
  onBulkRemoveFromCollection: (collection: CollectionSummary) => void;
  onBulkMerge: () => void;
  onBulkDelete: () => void;
  onOpenPlayer: (clip: ClipSummary) => void;
  onPlayAll: (queue: ClipSummary[]) => void;
  onOpenAsRealFolder: (collection: CollectionSummary) => void;
  onMergeCollection: (collection: CollectionSummary) => void;
  onScanNow: () => void;
  onRetryLoad: () => void;
  onOpenAddWatchFolder: () => void;
  onOpenSettingsFolders: () => void;
  onBrowseAllClips: () => void;
  onRenameCollection: (collection: CollectionSummary) => void;
  onDeleteCollection: (collection: CollectionSummary) => void;
  onToggleFavorite: (clip: ClipSummary) => void;
  onOpenCollectionPicker: (clip: ClipSummary) => void;
  onRemoveClipFromCollection: (clip: ClipSummary, collection: CollectionSummary) => void;
  onEditClip: (clip: ClipSummary) => void;
  onRevealFile: (clip: ClipSummary) => void;
  onDeleteClip: (clip: ClipSummary) => void;
  onOpenContextMenu: (x: number, y: number, entries: ContextMenuEntry[]) => void;
}

export function LibraryView({
  destination,
  games,
  collections,
  watchFolders,
  clips,
  totalCount,
  totalSizeBytes,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  scanning,
  error,
  searchQuery,
  selectedTags,
  onSelectedTagsChange,
  favoritesOnly,
  onFavoritesOnlyChange,
  durationPreset,
  onDurationPresetChange,
  sortBy,
  onSortByChange,
  onClearFilters,
  tags,
  streamerBaseUrl,
  streamerToken,
  linkingCollectionId,
  selectedIds,
  selectMode,
  onToggleSelectMode,
  onToggleSelectClip,
  onSelectAll,
  onClearSelection,
  onBulkAddToCollection,
  onBulkRemoveFromCollection,
  onBulkMerge,
  onBulkDelete,
  onOpenPlayer,
  onPlayAll,
  onOpenAsRealFolder,
  onMergeCollection,
  onScanNow,
  onRetryLoad,
  onOpenAddWatchFolder,
  onOpenSettingsFolders,
  onBrowseAllClips,
  onRenameCollection,
  onDeleteCollection,
  onToggleFavorite,
  onOpenCollectionPicker,
  onRemoveClipFromCollection,
  onEditClip,
  onRevealFile,
  onDeleteClip,
  onOpenContextMenu,
}: LibraryViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Match inclusive bounds of SQL query (<= 30, 30..120, >= 120).
  const visibleClips = useMemo(
    () =>
      clips.filter((c) => {
        if (durationPreset === "under_30") return c.durationSec <= 30;
        if (durationPreset === "30_to_120") return c.durationSec >= 30 && c.durationSec <= 120;
        if (durationPreset === "over_120") return c.durationSec >= 120;
        return true;
      }),
    [clips, durationPreset]
  );

  const activeGame =
    destination.kind === "game"
      ? games.find((g) => g.id === destination.gameId) ?? null
      : null;

  const activeCollection =
    destination.kind === "collection"
      ? collections.find((c) => c.id === destination.collectionId) ?? null
      : null;

  let headingTitle = "All Clips";
  let kindBadge: string | null = "Library";
  if (destination.kind === "favorites") {
    headingTitle = "Favorites";
    kindBadge = "Starred";
  } else if (destination.kind === "game") {
    headingTitle = activeGame?.displayName ?? "Game";
    kindBadge = "Game Folder";
  } else if (destination.kind === "collection" && activeCollection) {
    headingTitle = activeCollection.name;
    kindBadge = "Collection";
  }

  const hasActiveFilter =
    searchQuery.trim().length > 0 ||
    selectedTags.length > 0 ||
    favoritesOnly ||
    durationPreset !== "any";

  const selectionModeActive = selectMode || selectedIds.size > 0;

  const handleCardContextMenu = (clip: ClipSummary, x: number, y: number) => {
    if (selectedIds.size > 1 && selectedIds.has(clip.id)) {
      const count = selectedIds.size;
      const bulkEntries: ContextMenuEntry[] = [
        {
          id: "bulk-add-collection",
          label: `Add ${count} clips to Collection`,
          icon: FolderPlus,
          onSelect: onBulkAddToCollection,
        },
        ...(activeCollection?.kind === "manual"
          ? [
              {
                id: "bulk-remove-collection",
                label: `Remove ${count} clips from Collection`,
                icon: FolderMinus,
                onSelect: () => onBulkRemoveFromCollection(activeCollection),
              } satisfies ContextMenuEntry,
            ]
          : []),
        { id: "sep-bulk", type: "separator" },
        {
          id: "bulk-delete",
          label: `Delete ${count} clips`,
          icon: Trash2,
          danger: true,
          onSelect: onBulkDelete,
        },
      ];
      onOpenContextMenu(x, y, bulkEntries);
      return;
    }

    const singleEntries: ContextMenuEntry[] = [
      {
        id: "play-clip",
        label: "Play Clip",
        icon: Play,
        onSelect: () => onOpenPlayer(clip),
      },
      {
        id: "add-collection",
        label: "Add to Collection",
        icon: FolderPlus,
        onSelect: () => onOpenCollectionPicker(clip),
      },
      {
        id: "toggle-favorite",
        label: clip.isFavorite ? "Remove Favorite" : "Favorite",
        icon: Star,
        onSelect: () => onToggleFavorite(clip),
      },
      {
        id: "edit-clip",
        label: "Edit Title & Tags",
        icon: Pencil,
        onSelect: () => onEditClip(clip),
      },
      {
        id: "reveal-file",
        label: "Reveal Original File",
        icon: FolderOpen,
        onSelect: () => onRevealFile(clip),
      },
      ...(activeCollection?.kind === "manual"
        ? [
            {
              id: "remove-from-collection",
              label: "Remove from Collection",
              icon: FolderMinus,
              onSelect: () => onRemoveClipFromCollection(clip, activeCollection),
            } satisfies ContextMenuEntry,
          ]
        : []),
      { id: "sep-single", type: "separator" },
      {
        id: "delete-clip",
        label: "Delete Clip",
        icon: Trash2,
        danger: true,
        onSelect: () => onDeleteClip(clip),
      },
    ];
    onOpenContextMenu(x, y, singleEntries);
  };

  return (
    <main className="view-enter relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--surface-canvas)]">
      <div ref={scrollContainerRef} className="glint-scroll flex-1 overflow-y-auto">
        <LibraryToolbar
          headingTitle={headingTitle}
          kindBadge={kindBadge}
          totalCount={totalCount}
          totalSizeBytesFormatted={formatBytes(totalSizeBytes)}
          destination={destination}
          activeCollection={activeCollection}
          watchFolders={watchFolders}
          visibleClipsCount={visibleClips.length}
          selectionModeActive={selectionModeActive}
          linkingCollectionId={linkingCollectionId}
          scanning={scanning}
          hasActiveFilter={hasActiveFilter}
          selectedTags={selectedTags}
          tags={tags}
          favoritesOnly={favoritesOnly}
          durationPreset={durationPreset}
          sortBy={sortBy}
          onToggleSelectMode={onToggleSelectMode}
          onClearSelection={onClearSelection}
          onOpenAsRealFolder={onOpenAsRealFolder}
          onMergeCollection={onMergeCollection}
          onScanNow={onScanNow}
          onPlayAll={() => onPlayAll(visibleClips)}
          onRenameCollection={onRenameCollection}
          onDeleteCollection={onDeleteCollection}
          onSelectedTagsChange={onSelectedTagsChange}
          onFavoritesOnlyChange={onFavoritesOnlyChange}
          onDurationPresetChange={onDurationPresetChange}
          onClearFilters={onClearFilters}
          onSortByChange={onSortByChange}
        />

        <LibraryGrid
          scrollContainerRef={scrollContainerRef}
          headingTitle={headingTitle}
          destination={destination}
          activeCollection={activeCollection}
          watchFolders={watchFolders}
          clipsCount={clips.length}
          visibleClips={visibleClips}
          totalCount={totalCount}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          scanning={scanning}
          error={error}
          searchQuery={searchQuery}
          hasActiveFilter={hasActiveFilter}
          streamerBaseUrl={streamerBaseUrl}
          streamerToken={streamerToken}
          selectedIds={selectedIds}
          selectionModeActive={selectionModeActive}
          selectModeExplicit={selectMode}
          onLoadMore={onLoadMore}
          onRetryLoad={onRetryLoad}
          onOpenSettingsFolders={onOpenSettingsFolders}
          onClearFilters={onClearFilters}
          onOpenAddWatchFolder={onOpenAddWatchFolder}
          onBrowseAllClips={onBrowseAllClips}
          onScanNow={onScanNow}
          onToggleSelectClip={onToggleSelectClip}
          onOpenPlayer={onOpenPlayer}
          onToggleFavorite={onToggleFavorite}
          onCardContextMenu={handleCardContextMenu}
        />
      </div>

      <BulkActionBar
        selectedCount={selectedIds.size}
        activeCollection={activeCollection}
        onSelectAll={() => onSelectAll(visibleClips)}
        onClearSelection={onClearSelection}
        onBulkAddToCollection={onBulkAddToCollection}
        onBulkRemoveFromCollection={onBulkRemoveFromCollection}
        onBulkMerge={onBulkMerge}
        onBulkDelete={onBulkDelete}
      />
    </main>
  );
}
