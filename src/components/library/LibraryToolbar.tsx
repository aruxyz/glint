import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckSquare,
  ChevronDown,
  FolderCheck,
  Layers,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { GlassSelect } from "../GlassSelect";
import type {
  ClipSortBy,
  CollectionSummary,
  DurationFilterPreset,
  NavDestination,
  TagItem,
  WatchFolder,
} from "../../lib/types";

const DURATION_OPTIONS: ReadonlyArray<{ value: DurationFilterPreset; label: string }> = [
  { value: "any", label: "Any duration" },
  { value: "under_30", label: "Under 30s" },
  { value: "30_to_120", label: "30s to 2m" },
  { value: "over_120", label: "Over 2m" },
];

const SORT_OPTIONS: ReadonlyArray<{ value: ClipSortBy; label: string }> = [
  { value: "recorded_desc", label: "Newest first" },
  { value: "recorded_asc", label: "Oldest first" },
  { value: "duration_desc", label: "Longest" },
  { value: "size_desc", label: "Largest size" },
];

interface LibraryToolbarProps {
  headingTitle: string;
  kindBadge: string | null;
  totalCount: number;
  totalSizeBytesFormatted: string;
  destination: NavDestination;
  activeCollection: CollectionSummary | null;
  watchFolders: WatchFolder[];
  visibleClipsCount: number;
  selectionModeActive: boolean;
  linkingCollectionId: string | null;
  scanning: boolean;
  hasActiveFilter: boolean;
  selectedTags: string[];
  tags: TagItem[];
  favoritesOnly: boolean;
  durationPreset: DurationFilterPreset;
  sortBy: ClipSortBy;
  onToggleSelectMode: () => void;
  onClearSelection: () => void;
  onOpenAsRealFolder: (collection: CollectionSummary) => void;
  onMergeCollection: (collection: CollectionSummary) => void;
  onScanNow: () => void;
  onPlayAll: () => void;
  onRenameCollection: (collection: CollectionSummary) => void;
  onDeleteCollection: (collection: CollectionSummary) => void;
  onSelectedTagsChange: (tags: string[]) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onDurationPresetChange: (preset: DurationFilterPreset) => void;
  onClearFilters: () => void;
  onSortByChange: (sortBy: ClipSortBy) => void;
}

export function LibraryToolbar({
  headingTitle,
  kindBadge,
  totalCount,
  totalSizeBytesFormatted,
  destination,
  activeCollection,
  watchFolders,
  visibleClipsCount,
  selectionModeActive,
  linkingCollectionId,
  scanning,
  hasActiveFilter,
  selectedTags,
  tags,
  favoritesOnly,
  durationPreset,
  sortBy,
  onToggleSelectMode,
  onClearSelection,
  onOpenAsRealFolder,
  onMergeCollection,
  onScanNow,
  onPlayAll,
  onRenameCollection,
  onDeleteCollection,
  onSelectedTagsChange,
  onFavoritesOnlyChange,
  onDurationPresetChange,
  onClearFilters,
  onSortByChange,
}: LibraryToolbarProps) {
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setTagMenuOpen(false);
      }
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (tagMenuOpen || folderMenuOpen) {
        setTagMenuOpen(false);
        setFolderMenuOpen(false);
        return;
      }
      if (selectionModeActive) {
        const hasDialogOrMenu = Boolean(
          document.querySelector('[role="dialog"], [role="menu"]')
        );
        if (!hasDialogOrMenu) {
          onClearSelection();
        }
      }
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [tagMenuOpen, folderMenuOpen, selectionModeActive, onClearSelection]);

  const toggleTag = (name: string) => {
    if (selectedTags.includes(name)) {
      onSelectedTagsChange(selectedTags.filter((t) => t !== name));
    } else {
      onSelectedTagsChange([...selectedTags, name]);
    }
  };

  return (
    <div className="sticky top-0 z-20 glass-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-hairline)] px-6 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display truncate text-[20px] leading-7 font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
              {headingTitle}
            </h1>
            {kindBadge && (
              <span className="rounded-[6px] border border-[var(--border-hairline)] bg-[var(--surface-control)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]">
                {kindBadge}
              </span>
            )}
          </div>
          <p className="font-mono-tabular mt-0.5 text-[12px] text-[var(--text-secondary)]">
            {totalCount === 1 ? "1 clip" : `${totalCount} clips`} · {totalSizeBytesFormatted}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectionModeActive ? onClearSelection : onToggleSelectMode}
            disabled={visibleClipsCount === 0 && !selectionModeActive}
            aria-pressed={selectionModeActive}
            className={`btn-toggle-pill inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[13px] font-medium ${
              selectionModeActive
                ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)] hover:border-[#475569] disabled:opacity-50"
            }`}
          >
            <CheckSquare className="h-4 w-4" aria-hidden="true" />
            {selectionModeActive ? "Cancel Select" : "Select"}
          </button>

          {activeCollection && (
            <button
              type="button"
              onClick={() => onOpenAsRealFolder(activeCollection)}
              disabled={linkingCollectionId === activeCollection.id || totalCount === 0}
              className="btn-secondary h-9 px-3.5 text-[13px]"
            >
              <FolderCheck className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
              {linkingCollectionId === activeCollection.id
                ? "Linking..."
                : "Open as Real Folder"}
            </button>
          )}

          {activeCollection?.kind === "manual" && visibleClipsCount >= 2 && (
            <button
              type="button"
              onClick={() => onMergeCollection(activeCollection)}
              className="btn-secondary h-9 px-3.5 text-[13px]"
            >
              <Layers className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
              Merge Collection
            </button>
          )}

          {(destination.kind === "all" || destination.kind === "game") && (
            <button
              type="button"
              onClick={onScanNow}
              disabled={scanning || watchFolders.length === 0}
              className="btn-secondary h-9 px-3.5 text-[13px]"
            >
              <RefreshCw
                className={`h-4 w-4 text-[var(--text-secondary)] ${scanning ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {scanning ? "Scanning..." : "Scan Now"}
            </button>
          )}

          <button
            type="button"
            onClick={onPlayAll}
            disabled={visibleClipsCount === 0}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            Play All
          </button>

          {activeCollection && (
            <div ref={folderMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setFolderMenuOpen((prev) => !prev)}
                aria-label="Folder actions"
                aria-expanded={folderMenuOpen}
                className="btn-secondary h-9 w-9 p-0"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
              {folderMenuOpen && (
                <div
                  role="menu"
                  className="glass-dock popover-enter-down origin-top-right absolute right-0 top-10 z-30 w-44 rounded-[10px] p-1"
                >
                  {activeCollection.kind === "manual" && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setFolderMenuOpen(false);
                        onRenameCollection(activeCollection);
                      }}
                      className="nav-item-press flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] font-medium text-[var(--text-primary)] hover:bg-slate-900/5"
                    >
                      <Pencil className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                      Rename Collection
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setFolderMenuOpen(false);
                      onDeleteCollection(activeCollection);
                    }}
                    className="nav-item-press flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] font-medium text-[var(--status-error-fg)] hover:bg-[var(--status-error-bg)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete Collection
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div ref={tagMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setTagMenuOpen((prev) => !prev)}
              aria-expanded={tagMenuOpen}
              className={`btn-toggle-pill inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-medium ${
                selectedTags.length > 0
                  ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                  : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)] hover:border-[#475569]"
              }`}
            >
              <span>
                {selectedTags.length === 0 ? "Tags" : `Tags (${selectedTags.length})`}
              </span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            {tagMenuOpen && (
              <div className="glass-dock popover-enter-down origin-top-left absolute top-9 left-0 z-30 w-56 rounded-[10px] p-1.5">
                {tags.length === 0 ? (
                  <p className="px-2.5 py-2 text-[12px] text-[var(--text-muted)]">
                    No tags added to clips yet.
                  </p>
                ) : (
                  <div className="max-h-52 space-y-0.5 overflow-y-auto">
                    {tags.map((tag) => {
                      const active = selectedTags.includes(tag.name);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          role="checkbox"
                          aria-checked={active}
                          onClick={() => toggleTag(tag.name)}
                          className="nav-item-press flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-slate-900/5"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                                active
                                  ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white"
                                  : "border-[var(--border-control)] bg-[var(--surface-control)]"
                              }`}
                            >
                              {active && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                            </span>
                            <span className="truncate">{tag.name}</span>
                          </span>
                          <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                            {tag.clipCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {destination.kind !== "favorites" && (
            <button
              type="button"
              onClick={() => onFavoritesOnlyChange(!favoritesOnly)}
              aria-pressed={favoritesOnly}
              className={`btn-toggle-pill inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-medium ${
                favoritesOnly
                  ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                  : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)] hover:border-[#475569]"
              }`}
            >
              <Star
                className="h-3.5 w-3.5"
                fill={favoritesOnly ? "currentColor" : "none"}
                aria-hidden="true"
              />
              Favorites
            </button>
          )}

          <GlassSelect
            ariaLabel="Duration filter"
            value={durationPreset}
            options={DURATION_OPTIONS}
            onChange={onDurationPresetChange}
            placement="down"
            size="sm"
          />

          {hasActiveFilter && (
            <button
              type="button"
              onClick={onClearFilters}
              className="btn-toggle-pill h-8 rounded-[8px] px-2.5 text-[12px] font-medium text-[var(--accent-text)] hover:bg-[var(--accent-tint-bg)]"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label
            id="library-sort-label"
            htmlFor="library-sort-select"
            className="text-[12px] text-[var(--text-secondary)]"
          >
            Sort
          </label>
          <GlassSelect
            id="library-sort-select"
            ariaLabelledBy="library-sort-label"
            value={sortBy}
            options={SORT_OPTIONS}
            onChange={onSortByChange}
            placement="down"
            align="right"
            size="sm"
          />
        </div>
      </div>
    </div>
  );
}
