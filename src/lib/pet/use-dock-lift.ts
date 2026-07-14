import { useEffect, useState } from "react";
import { useUserTerminalsOptional } from "~/lib/user-terminal-store";

/**
 * How far the bottom terminal dock's top edge rises above the viewport bottom.
 * Pets perch on the dock instead of covering it: lift the whole pet by this
 * much so its feet sit on the dock's top edge. Returns 0 when there's no dock.
 *
 * A ResizeObserver follows the dock's slide open/close and drag-resizes; the
 * `dockActive` dep re-arms the observer when the dock mounts/unmounts on
 * project switches (it renders only on project/home scopes).
 *
 * Shared by the local Mission Pet and the remote (peer) pets so both sit on the
 * same plane — perched on the dock — instead of one floating inside the panel.
 *
 * Reads dock state optionally: the pet also renders outside UserTerminalProvider
 * (e.g. the desktop-overlay window), where there is no dock — return 0 there
 * instead of throwing.
 */
export function useDockLift(enabled = true): number {
  const userTerminals = useUserTerminalsOptional();
  const dockProject = userTerminals?.project ?? null;
  const homeActive = userTerminals?.homeActive ?? false;
  const dockActive = !!dockProject || homeActive;
  const [dockLift, setDockLift] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const dock = document.querySelector("[data-user-terminal-panel]");
      const rect = dock?.getBoundingClientRect();
      // A hidden or collapsing dock reports a zero-size rect whose top is 0 —
      // trusting it would set the lift to the full window height and slam the
      // pet to the very top of the screen. No box, no perch.
      setDockLift(
        rect && rect.height > 0 && rect.width > 0
          ? Math.max(0, window.innerHeight - rect.top)
          : 0,
      );
    };
    measure();
    let observer: ResizeObserver | null = null;
    const dock = document.querySelector("[data-user-terminal-panel]");
    if (dock && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(dock);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled, dockActive]);

  return dockLift;
}
