import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface GlassSelectOption<T extends string | number = string> {
  value: T;
  label: string;
}

interface GlassSelectProps<T extends string | number = string> {
  id?: string;
  value: T;
  options: ReadonlyArray<GlassSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  placement?: "auto" | "up" | "down";
  align?: "left" | "right";
  size?: "sm" | "md";
  mono?: boolean;
  disabled?: boolean;
  className?: string;
}

export function GlassSelect<T extends string | number = string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  placement = "auto",
  align = "left",
  size = "md",
  mono = false,
  disabled = false,
  className = "",
}: GlassSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [resolvedDir, setResolvedDir] = useState<"up" | "down">("down");
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
    minWidth: number;
  }>({ left: 0, top: 0, minWidth: 120 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value)
  );
  const selectedOption = options[selectedIndex];

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const portalTarget =
      (document.fullscreenElement as HTMLElement | null) ?? document.body;
    const baseRect =
      portalTarget === document.body
        ? { left: 0, top: 0 }
        : portalTarget.getBoundingClientRect();

    const menuEl = menuRef.current;
    const estHeight = Math.min(260, options.length * 32 + 10);
    const menuHeight = menuEl ? menuEl.offsetHeight : estHeight;
    const minWidth = Math.max(triggerRect.width, mono ? 96 : 150);
    const menuWidth = menuEl ? Math.max(menuEl.offsetWidth, minWidth) : minWidth;

    const spaceBelow = window.innerHeight - triggerRect.bottom - 8;
    const spaceAbove = triggerRect.top - 8;

    let dir: "up" | "down";
    if (placement === "up") {
      dir = "up";
    } else if (placement === "down") {
      dir = "down";
    } else {
      dir = spaceBelow < menuHeight && spaceAbove > spaceBelow ? "up" : "down";
    }

    const rawTop =
      dir === "up"
        ? triggerRect.top - menuHeight - 4
        : triggerRect.bottom + 4;
    const clampedTop = Math.max(
      8,
      Math.min(rawTop, window.innerHeight - menuHeight - 8)
    );

    const rawLeft =
      align === "right" ? triggerRect.right - menuWidth : triggerRect.left;
    const clampedLeft = Math.max(
      8,
      Math.min(rawLeft, window.innerWidth - menuWidth - 8)
    );

    setResolvedDir(dir);
    setCoords({
      left: clampedLeft - baseRect.left,
      top: clampedTop - baseRect.top,
      minWidth,
    });
  }, [align, mono, options.length, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const targetIdx = selectedIndex >= 0 ? selectedIndex : 0;
    optionRefs.current[targetIdx]?.focus({ preventScroll: true });
  }, [open, selectedIndex, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const raf = window.requestAnimationFrame(() => {
      updatePosition();
    });

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      updatePosition();
    };

    const handleResize = () => updatePosition();
    const handleFsChange = () => setOpen(false);

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    document.addEventListener("fullscreenchange", handleFsChange);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("fullscreenchange", handleFsChange);
    };
  }, [open, selectedIndex, updatePosition]);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  };

  const handleTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Enter" ||
      e.key === " "
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setOpen(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const targetIdx = selectedIndex >= 0 ? selectedIndex : 0;
        optionRefs.current[targetIdx]?.focus({ preventScroll: true });
      }
    }
  };

  const handleMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeAndFocusTrigger();
      return;
    }

    if (e.key === "Tab") {
      setOpen(false);
      return;
    }

    if (options.length === 0) return;

    const currentFocusIdx = optionRefs.current.findIndex(
      (el) => el === document.activeElement
    );

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const next =
        currentFocusIdx < 0
          ? 0
          : (currentFocusIdx + 1) % options.length;
      optionRefs.current[next]?.focus({ preventScroll: true });
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const prev =
        currentFocusIdx < 0
          ? options.length - 1
          : (currentFocusIdx - 1 + options.length) % options.length;
      optionRefs.current[prev]?.focus({ preventScroll: true });
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      optionRefs.current[0]?.focus({ preventScroll: true });
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      optionRefs.current[options.length - 1]?.focus({ preventScroll: true });
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (currentFocusIdx >= 0 && options[currentFocusIdx]) {
        onChange(options[currentFocusIdx].value);
      }
      closeAndFocusTrigger();
    }
  };

  const portalTarget =
    typeof document !== "undefined"
      ? (document.fullscreenElement as HTMLElement | null) ?? document.body
      : null;

  const heightClass = size === "sm" ? "h-8" : "h-9";

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={`btn-secondary ${heightClass} justify-between gap-2 px-2.5 text-[12px] ${
          mono ? "font-mono-tabular" : ""
        } ${
          open ? "border-[var(--accent-primary)]" : ""
        } ${className}`}
      >
        <span className="truncate">{selectedOption?.label ?? ""}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)] transition-transform duration-[150ms] ease-[var(--ease-fluent)] ${
            open ? "rotate-180" : "rotate-0"
          }`}
          aria-hidden="true"
        />
      </button>

      {open &&
        portalTarget &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            onKeyDown={handleMenuKeyDown}
            style={{
              left: `${coords.left}px`,
              top: `${coords.top}px`,
              minWidth: `${coords.minWidth}px`,
            }}
            className={`glass-dock glint-scroll fixed z-50 max-h-[260px] max-w-[280px] overflow-y-auto rounded-[10px] p-1 focus:outline-none ${
              resolvedDir === "up"
                ? "popover-enter origin-bottom"
                : "popover-enter-down origin-top"
            }`}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={String(opt.value)}
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value);
                    closeAndFocusTrigger();
                  }}
                  className={`nav-item-press flex w-full items-center justify-between gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[12px] ${
                    mono ? "font-mono-tabular" : ""
                  } ${
                    isSelected
                      ? "bg-[var(--accent-tint-bg)] font-semibold text-[var(--accent-text)]"
                      : "font-medium text-[var(--text-primary)] hover:bg-slate-900/5"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>,
          portalTarget
        )}
    </>
  );
}
