import { useEffect, useRef } from "react";
import { prefersReducedMotion, usePresence } from "../../hooks/usePresence";
import { formatDuration } from "../../lib/format";
import type { ClipSummary } from "../../lib/types";

interface PlayerQueueProps {
  open: boolean;
  isCompact: boolean;
  isFullscreen: boolean;
  activeClipId: string;
  queue: ClipSummary[];
  onSelectClip: (clip: ClipSummary) => void;
  onQueueContextMenu: (item: ClipSummary, x: number, y: number) => void;
}

export function PlayerQueue({
  open,
  isCompact,
  isFullscreen,
  activeClipId,
  queue,
  onSelectClip,
  onQueueContextMenu,
}: PlayerQueueProps) {
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const compactOpen = open && isCompact && !isFullscreen;
  const { present: compactPresent, isExiting: compactExiting } = usePresence(
    compactOpen,
    180
  );

  useEffect(() => {
    if (!open || isFullscreen) return;
    activeItemRef.current?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [activeClipId, open, isFullscreen]);

  if (isFullscreen) return null;

  const listContent = (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3.5 py-2.5">
        <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
          Up Next ({queue.length})
        </span>
      </div>
      <div className="glint-scroll flex-1 space-y-1 overflow-y-auto p-2">
        {queue.map((item, idx) => {
          const active = item.id === activeClipId;
          const label = item.title?.trim() || item.fileName;
          return (
            <button
              key={item.id}
              ref={active ? activeItemRef : undefined}
              type="button"
              onClick={() => onSelectClip(item)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onQueueContextMenu(item, e.clientX, e.clientY);
              }}
              className={`nav-item-press relative flex w-full items-center gap-2.5 rounded-[8px] py-2 pr-2 pl-3 text-left ${
                active
                  ? "bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                  : "text-[var(--text-primary)] hover:bg-slate-900/5"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-1.5 bottom-1.5 left-1 w-[3px] rounded-full bg-[var(--accent-primary)] transition-[transform,opacity] duration-[150ms] ease-[var(--ease-fluent)] ${
                  active ? "scale-y-100 opacity-100" : "scale-y-[0.4] opacity-0"
                }`}
              />
              <span className="font-mono-tabular w-5 shrink-0 text-[11px] text-[var(--text-muted)]">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold">{label}</p>
                <p className="font-mono-tabular text-[11px] text-[var(--text-secondary)]">
                  {formatDuration(item.durationSec)} · {item.gameName}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );

  if (isCompact) {
    if (!compactPresent) return null;
    return (
      <aside
        aria-label="Playlist queue"
        className={`glass-dock absolute top-0 right-0 bottom-0 z-30 flex w-[272px] flex-col border-l border-[var(--border-hairline)] ${
          compactExiting ? "drawer-right-exit pointer-events-none" : "drawer-right-enter"
        }`}
      >
        {listContent}
      </aside>
    );
  }

  return (
    <div
      data-testid="player-queue-shell"
      className={`queue-shell relative h-full shrink-0 overflow-hidden ${
        open ? "w-[272px]" : "pointer-events-none w-0"
      }`}
      inert={!open ? true : undefined}
      aria-hidden={!open ? true : undefined}
    >
      <aside
        aria-label="Playlist queue"
        className={`queue-inner glass-chrome flex h-full w-[272px] flex-col border-l border-[var(--border-hairline)] ${
          open ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
        }`}
      >
        {listContent}
      </aside>
    </div>
  );
}
