import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FolderPlus } from "lucide-react";
import { ClipCard } from "../ClipCard";
import type {
  ClipSummary,
  CollectionSummary,
  NavDestination,
  WatchFolder,
} from "../../lib/types";

const GRID_MIN_CARD_WIDTH_PX = 270;
const GRID_CARD_CHROME_HEIGHT_PX = 64;
const GRID_OVERSCAN_ROWS = 2;

interface LibraryGridProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  headingTitle: string;
  destination: NavDestination;
  activeCollection: CollectionSummary | null;
  watchFolders: WatchFolder[];
  clipsCount: number;
  visibleClips: ClipSummary[];
  totalCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  scanning: boolean;
  error: string | null;
  searchQuery: string;
  hasActiveFilter: boolean;
  streamerBaseUrl: string;
  streamerToken: string;
  selectedIds: Set<string>;
  selectionModeActive: boolean;
  selectModeExplicit: boolean;
  onLoadMore: () => void;
  onRetryLoad: () => void;
  onOpenSettingsFolders: () => void;
  onClearFilters: () => void;
  onOpenAddWatchFolder: () => void;
  onBrowseAllClips: () => void;
  onScanNow: () => void;
  onToggleSelectClip: (
    clip: ClipSummary,
    shiftKey: boolean,
    orderedClips: ClipSummary[]
  ) => void;
  onOpenPlayer: (clip: ClipSummary) => void;
  onToggleFavorite: (clip: ClipSummary) => void;
  onCardContextMenu: (clip: ClipSummary, x: number, y: number) => void;
}

export function LibraryGrid({
  scrollContainerRef,
  headingTitle,
  destination,
  activeCollection,
  watchFolders,
  clipsCount,
  visibleClips,
  totalCount,
  loading,
  loadingMore,
  hasMore,
  scanning,
  error,
  searchQuery,
  hasActiveFilter,
  streamerBaseUrl,
  streamerToken,
  selectedIds,
  selectionModeActive,
  selectModeExplicit,
  onLoadMore,
  onRetryLoad,
  onOpenSettingsFolders,
  onClearFilters,
  onOpenAddWatchFolder,
  onBrowseAllClips,
  onScanNow,
  onToggleSelectClip,
  onOpenPlayer,
  onToggleFavorite,
  onCardContextMenu,
}: LibraryGridProps) {
  const gridWrapperRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(900);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  const [scrollState, setScrollState] = useState({ scrollTop: 0, viewportHeight: 720 });

  const hasGrid = !error && !loading && visibleClips.length > 0;

  useEffect(() => {
    if (!hasGrid) return;
    const gridEl = gridWrapperRef.current;
    if (!gridEl) return;
    if (gridEl.clientWidth > 0) {
      setGridWidth(gridEl.clientWidth);
    }
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setGridWidth(w);
    });
    ro.observe(gridEl);
    return () => ro.disconnect();
  }, [hasGrid]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    let rafId = 0;
    const update = () => {
      rafId = 0;
      setScrollState((prev) => {
        const nextTop = scroller.scrollTop;
        const nextHeight = scroller.clientHeight || 720;
        if (prev.scrollTop === nextTop && prev.viewportHeight === nextHeight) {
          return prev;
        }
        return { scrollTop: nextTop, viewportHeight: nextHeight };
      });
    };

    const onScroll = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(update);
    };

    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(scroller);
    }
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
  }, [scrollContainerRef]);

  const virtualWindow = useMemo(() => {
    const gapPx = viewportWidth >= 1280 ? 20 : 16;
    const cols = Math.max(1, Math.floor((gridWidth + gapPx) / (GRID_MIN_CARD_WIDTH_PX + gapPx)));
    const colWidth = Math.max(120, (gridWidth - gapPx * (cols - 1)) / cols);
    const rowHeight = Math.max(140, Math.round((colWidth * 9) / 16 + GRID_CARD_CHROME_HEIGHT_PX + gapPx));
    const totalRows = Math.ceil(visibleClips.length / cols);

    if (totalRows === 0) {
      return {
        cols,
        topSpacerPx: 0,
        bottomSpacerPx: 0,
        renderedClips: [] as ClipSummary[],
      };
    }

    const gridOffsetTop = gridWrapperRef.current?.offsetTop ?? 0;
    const relScrollTop = Math.max(0, scrollState.scrollTop - gridOffsetTop);
    const startRow = Math.max(0, Math.floor(relScrollTop / rowHeight) - GRID_OVERSCAN_ROWS);
    const endRow = Math.min(
      totalRows - 1,
      Math.ceil((relScrollTop + scrollState.viewportHeight) / rowHeight) + GRID_OVERSCAN_ROWS
    );

    const topSpacerPx = startRow * rowHeight;
    const bottomSpacerPx = Math.max(0, (totalRows - 1 - endRow) * rowHeight);
    const sliceStart = startRow * cols;
    const sliceEnd = Math.min(visibleClips.length, (endRow + 1) * cols);

    return {
      cols,
      topSpacerPx,
      bottomSpacerPx,
      renderedClips: visibleClips.slice(sliceStart, sliceEnd),
    };
  }, [gridWidth, scrollState.scrollTop, scrollState.viewportHeight, viewportWidth, visibleClips]);

  return (
    <div
      className={`p-4 lg:p-6 ${
        selectedIds.size > 0 ? "pb-24 lg:pb-24" : ""
      }`}
    >
      {error ? (
        <div
          role="alert"
          className="mx-auto mt-12 max-w-[440px] rounded-[12px] border border-red-200 bg-[var(--status-error-bg)] p-6 text-center"
        >
          <h2 className="text-[15px] font-semibold text-[var(--status-error-fg)]">
            Could not load clips
          </h2>
          <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">{error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={onRetryLoad}
              className="btn-secondary h-9 px-4 text-[13px]"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onOpenSettingsFolders}
              className="btn-secondary h-9 px-4 text-[13px]"
            >
              Folder Settings
            </button>
          </div>
        </div>
      ) : loading ? (
        <div
          aria-busy="true"
          aria-label={`Loading ${headingTitle}`}
          className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4 xl:gap-5"
        >
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2 shadow-[var(--border-card-specular)]"
            >
              <div className="aspect-video w-full animate-pulse rounded-[10px] bg-slate-200" />
              <div className="mt-2.5 space-y-1.5 px-1 pb-1">
                <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleClips.length === 0 ? (
        <div className="mx-auto mt-14 max-w-[420px] rounded-[14px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-6 text-center shadow-[var(--border-card-specular),var(--shadow-card-rest)]">
          {hasActiveFilter ? (
            <>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                No matching clips
              </h2>
              <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                {searchQuery.trim()
                  ? `No clips match "${searchQuery.trim()}" and your active filters.`
                  : "No clips match your active filters."}
              </p>
              <button
                type="button"
                onClick={onClearFilters}
                className="btn-secondary mt-4 h-9 px-4 text-[13px]"
              >
                Clear Filters
              </button>
            </>
          ) : activeCollection?.kind === "manual" ? (
            <>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                This collection is empty
              </h2>
              <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                {watchFolders.length === 0
                  ? "Connect a ShadowPlay folder first, then add clips here without moving originals."
                  : "Add clips from your library without moving original files."}
              </p>
              <button
                type="button"
                onClick={
                  watchFolders.length === 0
                    ? onOpenAddWatchFolder
                    : onBrowseAllClips
                }
                className="btn-secondary mt-4 h-9 px-4 text-[13px]"
              >
                {watchFolders.length === 0
                  ? "Add Watch Folder"
                  : "Browse All Clips"}
              </button>
            </>
          ) : watchFolders.length === 0 ? (
            <>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                No clip folders connected
              </h2>
              <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                Add your ShadowPlay, OBS Studio, Steam, or local video folder to load clips.
              </p>
              <button
                type="button"
                onClick={onOpenAddWatchFolder}
                className="btn-primary mt-4 h-9 px-4 text-[13px]"
              >
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
                Add Watch Folder
              </button>
            </>
          ) : destination.kind === "favorites" ? (
            <>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                No favorite clips yet
              </h2>
              <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                Star any clip to pin it here and protect it from auto-cleanup.
              </p>
              <button
                type="button"
                onClick={onBrowseAllClips}
                className="btn-secondary mt-4 h-9 px-4 text-[13px]"
              >
                Browse All Clips
              </button>
            </>
          ) : (
            <>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                No clips found in this folder
              </h2>
              <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                Record a clip with ShadowPlay or check another watch folder.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={onScanNow}
                  disabled={scanning}
                  className="btn-primary h-9 px-4 text-[13px]"
                >
                  Rescan Folder
                </button>
                <button
                  type="button"
                  onClick={onOpenSettingsFolders}
                  className="btn-secondary h-9 px-4 text-[13px]"
                >
                  Folder Settings
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div ref={gridWrapperRef} data-testid="library-virtual-grid-wrapper">
          {virtualWindow.topSpacerPx > 0 && (
            <div style={{ height: `${virtualWindow.topSpacerPx}px` }} aria-hidden="true" />
          )}
          <div
            className="grid gap-4 xl:gap-5"
            style={{ gridTemplateColumns: `repeat(${virtualWindow.cols}, minmax(0, 1fr))` }}
          >
            {virtualWindow.renderedClips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                streamerBaseUrl={streamerBaseUrl}
                streamerToken={streamerToken}
                selected={selectedIds.has(clip.id)}
                selectionMode={selectionModeActive}
                selectModeExplicit={selectModeExplicit}
                onToggleSelect={(c, shiftKey) =>
                  onToggleSelectClip(c, shiftKey, visibleClips)
                }
                onOpenPlayer={onOpenPlayer}
                onToggleFavorite={onToggleFavorite}
                onOpenContextMenu={onCardContextMenu}
              />
            ))}
          </div>
          {virtualWindow.bottomSpacerPx > 0 && (
            <div style={{ height: `${virtualWindow.bottomSpacerPx}px` }} aria-hidden="true" />
          )}

          {hasMore && (
            <div className="mt-6 flex flex-col items-center justify-center gap-2">
              <p className="font-mono-tabular text-[12px] text-[var(--text-secondary)]">
                Showing {clipsCount} of {totalCount} clips
              </p>
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="btn-secondary h-9 px-4 text-[13px]"
              >
                {loadingMore
                  ? "Loading more..."
                  : `Load More (${totalCount - clipsCount} remaining)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
