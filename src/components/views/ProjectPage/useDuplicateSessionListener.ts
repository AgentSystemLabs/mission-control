import { useEffect, useRef } from "react";
import { DUPLICATE_ACTIVE_SESSION_EVENT } from "~/lib/design-meta";

// Direct window-capture listener (not useHotkey) — xterm's focused textarea
// intermittently masks the action-based hook after a focus change. Mirrors
// the proven Cmd+[/Cmd+] pattern in __root.tsx. Cmd+Shift+] / Cmd+Shift+[
// arrive as e.key="}" / e.key="{" on US layouts, so match by e.code instead.
export function useDuplicateSessionListener(
  cycleSession: (direction: 1 | -1) => void,
  duplicateActiveSession: () => void,
) {
  const cycleSessionRef = useRef(cycleSession);
  cycleSessionRef.current = cycleSession;

  const duplicateActiveSessionRef = useRef(duplicateActiveSession);
  duplicateActiveSessionRef.current = duplicateActiveSession;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!e.shiftKey || e.altKey) return;
      if (e.code === "BracketRight") {
        e.preventDefault();
        e.stopPropagation();
        cycleSessionRef.current(1);
      } else if (e.code === "BracketLeft") {
        e.preventDefault();
        e.stopPropagation();
        cycleSessionRef.current(-1);
      } else if (e.code === "KeyD") {
        e.preventDefault();
        e.stopPropagation();
        duplicateActiveSessionRef.current();
      }
    };
    const onDuplicateRequest = () => duplicateActiveSessionRef.current();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(DUPLICATE_ACTIVE_SESSION_EVENT, onDuplicateRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(DUPLICATE_ACTIVE_SESSION_EVENT, onDuplicateRequest);
    };
  }, []);
}
