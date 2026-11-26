import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isTauriRuntime } from "../lib/api";
import type {
  BootstrapState,
  ClipSortBy,
  ClipSummary,
  CollectionSummary,
  DurationFilterPreset,
  GameSummary,
  ListClipsQuery,
  NavDestination,
  TagItem,
} from "../lib/types";

export const CLIP_PAGE_SIZE = 200;

function getDurationBounds(preset: DurationFilterPreset): {
  minDurationSec: number | null;
  maxDurationSec: number | null;
} {
  if (preset === "under_30") return { minDurationSec: null, maxDurationSec: 30 };
  if (preset === "30_to_120") return { minDurationSec: 30, maxDurationSec: 120 };
  if (preset === "over_120") return { minDurationSec: 120, maxDurationSec: null };
  return { minDurationSec: null, maxDurationSec: null };
}

export function useLibrary(settingsOpen: boolean) {
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const [games, setGames] = useState<GameSummary[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);

  const [destination, setDestination] = useState<NavDestination>({ kind: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [durationPreset, setDurationPreset] = useState<DurationFilterPreset>("any");
  const [sortBy, setSortBy] = useState<ClipSortBy>("recorded_desc");

  const [clips, setClips] = useState<ClipSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [clipsError, setClipsError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);

  const [activeClip, setActiveClip] = useState<ClipSummary | null>(null);
  const [playerQueue, setPlayerQueue] = useState<ClipSummary[]>([]);

  const queryGenerationRef = useRef(0);

  const buildQuery = useCallback(
    (offset: number): ListClipsQuery => {
      const { minDurationSec, maxDurationSec } = getDurationBounds(durationPreset);
      return {
        gameId: destination.kind === "game" ? destination.gameId : null,
        collectionId:
          destination.kind === "collection" ? destination.collectionId : null,
        tagNames: selectedTags.length > 0 ? selectedTags : null,
        search: searchQuery.trim() ? searchQuery.trim() : null,
        favoritesOnly: destination.kind === "favorites" || favoritesOnly,
        minDurationSec,
        maxDurationSec,
        sortBy,
        limit: CLIP_PAGE_SIZE,
        offset,
      };
    },
    [
      destination,
      durationPreset,
      favoritesOnly,
      searchQuery,
      selectedTags,
      sortBy,
    ]
  );

  const refreshMetadata = useCallback(async () => {
    try {
      const [nextBoot, nextGames, nextTags, nextCols] = await Promise.all([
        api.getBootstrapState(),
        api.listGames(),
        api.listTags(),
        api.listCollections(),
      ]);
      setBootstrap(nextBoot);
      setGames(nextGames);
      setTags(nextTags);
      setCollections(nextCols);
    } catch {
      // Keep existing state if background metadata refresh fails transiently.
    }
  }, []);

  const loadClips = useCallback(async () => {
    const gen = ++queryGenerationRef.current;
    const query = buildQuery(0);

    setClipsLoading(true);
    setClipsError(null);
    try {
      const result = await api.listClips(query);
      if (gen !== queryGenerationRef.current) return;
      setClips(result.items);
      setTotalCount(result.total);
      setTotalSizeBytes(result.totalSizeBytes);
    } catch (err) {
      if (gen !== queryGenerationRef.current) return;
      setClipsError(err instanceof Error ? err.message : "Failed to load clips.");
    } finally {
      if (gen === queryGenerationRef.current) {
        setClipsLoading(false);
      }
    }
  }, [buildQuery]);

  const loadMoreClips = useCallback(async () => {
    if (clipsLoading || loadingMore || clips.length >= totalCount) return;
    const gen = queryGenerationRef.current;
    const query = buildQuery(clips.length);

    setLoadingMore(true);
    try {
      const result = await api.listClips(query);
      if (gen !== queryGenerationRef.current) return;
      setClips((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const appended = result.items.filter((c) => !seen.has(c.id));
        return [...prev, ...appended];
      });
      setTotalCount(result.total);
      setTotalSizeBytes(result.totalSizeBytes);
    } catch (err) {
      if (gen !== queryGenerationRef.current) return;
      setClipsError(err instanceof Error ? err.message : "Failed to load more clips.");
    } finally {
      if (gen === queryGenerationRef.current) {
        setLoadingMore(false);
      }
    }
  }, [buildQuery, clips.length, clipsLoading, loadingMore, totalCount]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.getBootstrapState(),
      api.listGames(),
      api.listTags(),
      api.listCollections(),
    ])
      .then(([boot, g, t, c]) => {
        if (!mounted) return;
        setBootstrap(boot);
        setGames(g);
        setTags(t);
        setCollections(c);
        setBootstrapped(true);
      })
      .catch(() => {
        if (!mounted) return;
        setBootstrapped(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const showOnboarding =
    bootstrapped &&
    (bootstrap?.watchFolders.length ?? 0) === 0 &&
    !onboardingDismissed;

  useEffect(() => {
    if (!bootstrapped || showOnboarding || settingsOpen) return;
    loadClips();
  }, [bootstrapped, showOnboarding, settingsOpen, loadClips]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setSelectMode(false);
  }, []);

  const handleToggleSelectClip = useCallback(
    (clip: ClipSummary, shiftKey: boolean, orderedClips: ClipSummary[]) => {
      if (shiftKey && lastSelectedId) {
        const startIdx = orderedClips.findIndex((c) => c.id === lastSelectedId);
        const endIdx = orderedClips.findIndex((c) => c.id === clip.id);
        if (startIdx >= 0 && endIdx >= 0) {
          const lo = Math.min(startIdx, endIdx);
          const hi = Math.max(startIdx, endIdx);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (let i = lo; i <= hi; i += 1) {
              next.add(orderedClips[i].id);
            }
            return next;
          });
          setLastSelectedId(clip.id);
          return;
        }
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(clip.id)) next.delete(clip.id);
        else next.add(clip.id);
        return next;
      });
      setLastSelectedId(clip.id);
    },
    [lastSelectedId]
  );

  const handleToggleFavorite = useCallback(
    async (clip: ClipSummary) => {
      const nextVal = !clip.isFavorite;
      setClips((prev) =>
        prev.map((c) => (c.id === clip.id ? { ...c, isFavorite: nextVal } : c))
      );
      setPlayerQueue((prev) =>
        prev.map((c) => (c.id === clip.id ? { ...c, isFavorite: nextVal } : c))
      );
      setActiveClip((prev) =>
        prev && prev.id === clip.id ? { ...prev, isFavorite: nextVal } : prev
      );
      if (!isTauriRuntime()) return;
      try {
        const updated = await api.updateClipMeta({
          clipId: clip.id,
          isFavorite: nextVal,
        });
        setClips((prev) =>
          prev.map((c) => (c.id === clip.id ? updated.clip : c))
        );
        setPlayerQueue((prev) =>
          prev.map((c) => (c.id === clip.id ? updated.clip : c))
        );
        setActiveClip((prev) =>
          prev && prev.id === clip.id ? updated.clip : prev
        );
        refreshMetadata();
      } catch {
        setClips((prev) =>
          prev.map((c) =>
            c.id === clip.id ? { ...c, isFavorite: clip.isFavorite } : c
          )
        );
        setPlayerQueue((prev) =>
          prev.map((c) =>
            c.id === clip.id ? { ...c, isFavorite: clip.isFavorite } : c
          )
        );
      }
    },
    [refreshMetadata]
  );

  const contextLabel = useMemo(() => {
    if (settingsOpen) return "Settings";
    if (destination.kind === "all") return "All Clips";
    if (destination.kind === "favorites") return "Favorites";
    if (destination.kind === "game") {
      return games.find((g) => g.id === destination.gameId)?.displayName ?? "Game";
    }
    return (
      collections.find((c) => c.id === destination.collectionId)?.name ?? "Collection"
    );
  }, [collections, destination, games, settingsOpen]);

  return {
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
  };
}
