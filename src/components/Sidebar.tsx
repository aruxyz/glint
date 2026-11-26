import {
  Film,
  FolderCheck,
  FolderHeart,
  Gamepad2,
  HardDrive,
  Layers,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import type { ContextMenuEntry } from "./ContextMenu";
import { usePresence } from "../hooks/usePresence";
import { formatGb } from "../lib/format";
import type {
  CollectionSummary,
  GameSummary,
  LibraryStats,
  NavDestination,
} from "../lib/types";

interface SidebarProps {
  open: boolean;
  isCompactViewport: boolean;
  onCloseCompact: () => void;
  destination: NavDestination;
  onSelectDestination: (dest: NavDestination) => void;
  stats: LibraryStats;
  games: GameSummary[];
  collections: CollectionSummary[];
  maxStorageGb: number;
  onCreateCollection: () => void;
  onOpenStorageSettings: () => void;
  onOpenAsRealFolder: (collection: CollectionSummary) => void;
  onMergeCollection: (collection: CollectionSummary) => void;
  onRenameCollection: (collection: CollectionSummary) => void;
  onDeleteCollection: (collection: CollectionSummary) => void;
  onOpenContextMenu: (x: number, y: number, entries: ContextMenuEntry[]) => void;
}

function isSameDestination(a: NavDestination, b: NavDestination): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "game" && b.kind === "game") return a.gameId === b.gameId;
  if (a.kind === "collection" && b.kind === "collection") {
    return a.collectionId === b.collectionId;
  }
  return true;
}

export function Sidebar({
  open,
  isCompactViewport,
  onCloseCompact,
  destination,
  onSelectDestination,
  stats,
  games,
  collections,
  maxStorageGb,
  onCreateCollection,
  onOpenStorageSettings,
  onOpenAsRealFolder,
  onMergeCollection,
  onRenameCollection,
  onDeleteCollection,
  onOpenContextMenu,
}: SidebarProps) {
  const { present: compactPresent, isExiting: compactExiting } = usePresence(
    open && isCompactViewport,
    180
  );

  const manualCollections = collections.filter((c) => c.kind === "manual");

  const usedGbNum = stats.totalSizeBytes / (1024 * 1024 * 1024);
  const usedGbStr = formatGb(stats.totalSizeBytes);
  const hasLimit = maxStorageGb > 0;
  const usageRatio = hasLimit ? Math.min(1, usedGbNum / maxStorageGb) : 0;
  const isQuotaHigh = hasLimit && usageRatio >= 0.85;

  const selectAndMaybeClose = (dest: NavDestination) => {
    onSelectDestination(dest);
    if (isCompactViewport) {
      onCloseCompact();
    }
  };

  const navItemClass = (active: boolean) =>
    `nav-item-press group relative flex w-full items-center justify-between gap-2 rounded-[8px] py-1.5 pr-3 pl-3.5 text-left text-[13px] ${
      active
        ? "bg-[var(--accent-tint-bg)] font-semibold text-[var(--accent-text)]"
        : "font-medium text-[var(--text-primary)] hover:bg-slate-900/5"
    }`;

  const activeIndicator = (active: boolean) => (
    <span
      aria-hidden="true"
      className={`absolute top-1.5 bottom-1.5 left-1 w-[3px] rounded-full bg-[var(--accent-primary)] transition-[transform,opacity] duration-[150ms] ease-[var(--ease-fluent)] ${
        active ? "scale-y-100 opacity-100" : "scale-y-[0.35] opacity-0"
      }`}
    />
  );

  const handleCollectionContextMenu = (
    col: CollectionSummary,
    x: number,
    y: number
  ) => {
    onOpenContextMenu(x, y, [
      {
        id: "col-open-real",
        label: "Open as Real Folder",
        icon: FolderCheck,
        disabled: col.clipCount === 0,
        onSelect: () => onOpenAsRealFolder(col),
      },
      {
        id: "col-merge",
        label: "Merge Collection",
        icon: Layers,
        disabled: col.clipCount < 2,
        onSelect: () => onMergeCollection(col),
      },
      {
        id: "col-rename",
        label: "Rename Collection",
        icon: Pencil,
        onSelect: () => onRenameCollection(col),
      },
      { id: "col-sep", type: "separator" },
      {
        id: "col-delete",
        label: "Delete Collection",
        icon: Trash2,
        danger: true,
        onSelect: () => onDeleteCollection(col),
      },
    ]);
  };

  const sidebarBody = (
    <aside
      aria-label="Library navigation"
      className={`flex h-full w-[232px] xl:w-[256px] shrink-0 flex-col border-r border-[var(--border-hairline)] ${
        isCompactViewport
          ? `glass-drawer ${
              compactExiting ? "drawer-left-exit" : "drawer-left-enter"
            }`
          : `sidebar-inner glass-chrome ${
              open ? "translate-x-0 opacity-100" : "-translate-x-4 opacity-0"
            }`
      }`}
    >
      <nav className="glint-scroll flex-1 overflow-y-auto px-2.5 py-3">
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => selectAndMaybeClose({ kind: "all" })}
            className={navItemClass(isSameDestination(destination, { kind: "all" }))}
          >
            {activeIndicator(isSameDestination(destination, { kind: "all" }))}
            <span className="flex min-w-0 items-center gap-2.5">
              <Film className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">All Clips</span>
            </span>
            <span className="font-mono-tabular shrink-0 text-[11px] text-[var(--text-muted)]">
              {stats.totalClips}
            </span>
          </button>

          <button
            type="button"
            onClick={() => selectAndMaybeClose({ kind: "favorites" })}
            className={navItemClass(isSameDestination(destination, { kind: "favorites" }))}
          >
            {activeIndicator(isSameDestination(destination, { kind: "favorites" }))}
            <span className="flex min-w-0 items-center gap-2.5">
              <Star className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Favorites</span>
            </span>
            <span className="font-mono-tabular shrink-0 text-[11px] text-[var(--text-muted)]">
              {stats.totalFavorites}
            </span>
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between px-3">
            <span className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text-secondary)]">
              Games
            </span>
          </div>
          {games.length === 0 ? (
            <p className="px-3 py-1 text-[12px] text-[var(--text-muted)]">
              No games indexed
            </p>
          ) : (
            <div className="space-y-0.5">
              {games.map((game) => {
                const active = isSameDestination(destination, {
                  kind: "game",
                  gameId: game.id,
                });
                return (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => selectAndMaybeClose({ kind: "game", gameId: game.id })}
                    className={navItemClass(active)}
                  >
                    {activeIndicator(active)}
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Gamepad2 className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                      <span className="truncate">{game.displayName}</span>
                    </span>
                    <span className="font-mono-tabular shrink-0 text-[11px] text-[var(--text-muted)]">
                      {game.clipCount}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5">
          <div className="mb-1.5 px-3">
            <span className="text-[12px] font-semibold tracking-[0.02em] text-[var(--text-secondary)]">
              Collections
            </span>
          </div>
          <div className="space-y-0.5">
            {manualCollections.map((col) => {
              const active = isSameDestination(destination, {
                kind: "collection",
                collectionId: col.id,
              });
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={() =>
                    selectAndMaybeClose({ kind: "collection", collectionId: col.id })
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCollectionContextMenu(col, e.clientX, e.clientY);
                  }}
                  className={navItemClass(active)}
                >
                  {activeIndicator(active)}
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FolderHeart className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                    <span className="truncate">{col.name}</span>
                  </span>
                  <span className="font-mono-tabular shrink-0 text-[11px] text-[var(--text-muted)]">
                    {col.clipCount}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={onCreateCollection}
              className="nav-item-press flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-left text-[12px] font-medium text-[var(--text-muted)] hover:bg-slate-900/5 hover:text-[var(--text-primary)]"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>New Collection</span>
            </button>
          </div>
        </div>
      </nav>

      <div className="border-t border-[var(--border-hairline)] p-3">
        <button
          type="button"
          onClick={onOpenStorageSettings}
          className="nav-item-press w-full rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2.5 text-left shadow-[var(--border-card-specular)] hover:bg-[var(--surface-card-hover)]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-primary)]">
              <HardDrive className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
              Watch Storage
            </span>
            {isQuotaHigh && (
              <span className="rounded bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-warning-fg)]">
                Near limit
              </span>
            )}
          </div>
          <div className="font-mono-tabular mt-1.5 text-[11px] text-[var(--text-secondary)]">
            {hasLimit ? `${usedGbStr} GB / ${maxStorageGb} GB` : `${usedGbStr} GB · No limit`}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/90">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: hasLimit ? `${Math.max(4, Math.round(usageRatio * 100))}%` : "0%",
                backgroundColor: isQuotaHigh
                  ? "var(--status-warning-fg)"
                  : "var(--accent-primary)",
              }}
            />
          </div>
        </button>
      </div>
    </aside>
  );

  if (isCompactViewport) {
    if (!compactPresent) return null;
    return (
      <div className="fixed inset-x-0 top-9 bottom-0 z-40 flex">
        {sidebarBody}
        <div
          className={`flex-1 bg-slate-900/20 ${
            compactExiting ? "drawer-backdrop-exit" : "drawer-backdrop-enter"
          }`}
          onClick={onCloseCompact}
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div
      data-testid="desktop-sidebar-shell"
      className={`sidebar-shell relative h-full shrink-0 overflow-hidden ${
        open ? "w-[232px] xl:w-[256px]" : "pointer-events-none w-0"
      }`}
      inert={!open ? true : undefined}
      aria-hidden={!open ? true : undefined}
    >
      {sidebarBody}
    </div>
  );
}
