import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type ContextMenuEntry =
  | ContextMenuItem
  | { id: string; type: "separator" };

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  entries: ContextMenuEntry[];
  onClose: () => void;
}

function isSeparator(
  entry: ContextMenuEntry
): entry is { id: string; type: "separator" } {
  return "type" in entry && entry.type === "separator";
}

export function ContextMenu({
  open,
  x,
  y,
  entries,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState({ left: x, top: y });

  const actionItems = useMemo(
    () => entries.filter((entry): entry is ContextMenuItem => !isSeparator(entry)),
    [entries]
  );

  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const clampedLeft = Math.max(
      pad,
      Math.min(x, window.innerWidth - rect.width - pad)
    );
    const clampedTop = Math.max(
      pad,
      Math.min(y, window.innerHeight - rect.height - pad)
    );
    setPos({ left: clampedLeft, top: clampedTop });
  }, [open, x, y, entries]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const firstEnabledIdx = actionItems.findIndex((item) => !item.disabled);
      if (firstEnabledIdx >= 0) {
        itemRefs.current[firstEnabledIdx]?.focus({ preventScroll: true });
      } else {
        menuRef.current?.focus({ preventScroll: true });
      }
    });

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleScroll = () => onClose();
    const handleResize = () => onClose();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const enabledIndices = actionItems
          .map((item, idx) => (item.disabled ? -1 : idx))
          .filter((idx) => idx >= 0);
        if (enabledIndices.length === 0) return;

        const activeEl = document.activeElement;
        const currentActionIdx = itemRefs.current.findIndex((el) => el === activeEl);
        const currentPos = enabledIndices.indexOf(currentActionIdx);

        let nextEnabledIdx: number;
        if (e.key === "ArrowDown") {
          nextEnabledIdx =
            currentPos < 0
              ? enabledIndices[0]
              : enabledIndices[(currentPos + 1) % enabledIndices.length];
        } else {
          nextEnabledIdx =
            currentPos < 0
              ? enabledIndices[enabledIndices.length - 1]
              : enabledIndices[
                  (currentPos - 1 + enabledIndices.length) % enabledIndices.length
                ];
        }
        itemRefs.current[nextEnabledIdx]?.focus({ preventScroll: true });
        return;
      }

      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const enabledIndices = actionItems
          .map((item, idx) => (item.disabled ? -1 : idx))
          .filter((idx) => idx >= 0);
        if (enabledIndices.length === 0) return;
        const targetIdx =
          e.key === "Home"
            ? enabledIndices[0]
            : enabledIndices[enabledIndices.length - 1];
        itemRefs.current[targetIdx]?.focus({ preventScroll: true });
      }
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, actionItems, onClose]);

  if (!open || entries.length === 0) return null;

  let actionCounter = -1;

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      className="glass-dock popover-enter-down origin-top-left fixed z-50 min-w-[200px] rounded-[10px] p-1 focus:outline-none"
    >
      {entries.map((entry) => {
        if (isSeparator(entry)) {
          return (
            <div
              key={entry.id}
              role="separator"
              className="my-1 border-t border-[var(--border-hairline)]"
            />
          );
        }

        actionCounter += 1;
        const idx = actionCounter;
        const Icon = entry.icon;

        return (
          <button
            key={entry.id}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              if (entry.disabled) return;
              onClose();
              entry.onSelect();
            }}
            className={`nav-item-press flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] font-medium disabled:opacity-45 ${
              entry.danger
                ? "text-[var(--status-error-fg)] hover:bg-[var(--status-error-bg)] focus-visible:bg-[var(--status-error-bg)]"
                : "text-[var(--text-primary)] hover:bg-slate-900/5 focus-visible:bg-slate-900/5"
            }`}
          >
            {Icon && (
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${
                  entry.danger
                    ? "text-[var(--status-error-fg)]"
                    : "text-[var(--text-secondary)]"
                }`}
                aria-hidden="true"
              />
            )}
            <span className="truncate">{entry.label}</span>
          </button>
        );
      })}
    </div>
  );
}
