import { useEffect, useState } from "react";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Keeps an overlay mounted during its exit animation before unmounting from the DOM.
 */
export function usePresence(
  open: boolean,
  exitDurationMs = 180
): { present: boolean; isExiting: boolean } {
  const [present, setPresent] = useState(open);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (open) {
      setPresent(true);
      setIsExiting(false);
      return;
    }

    if (!present) {
      setIsExiting(false);
      return;
    }

    if (exitDurationMs <= 0 || prefersReducedMotion()) {
      setIsExiting(false);
      setPresent(false);
      return;
    }

    setIsExiting(true);
    const timer = window.setTimeout(() => {
      setIsExiting(false);
      setPresent(false);
    }, exitDurationMs);

    return () => window.clearTimeout(timer);
  }, [open, exitDurationMs, present]);

  return { present, isExiting };
}
