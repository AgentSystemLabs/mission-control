import { useEffect } from "react";

// Two-finger trackpad horizontal swipe → fires `onTrigger` once when the user
// has accumulated `threshold` px in the chosen direction. Re-arms only after
// the wheel has been idle for `idleMs` (covers macOS inertial fall-off).
export function useWheelSwipe(
  direction: "left" | "right",
  onTrigger: () => void,
  threshold = 250,
  idleMs = 250,
) {
  useEffect(() => {
    let deltaX = 0;
    let triggered = false;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        deltaX = 0;
        triggered = false;
      }, idleMs);
      if (triggered) return;
      deltaX += e.deltaX;
      const past =
        direction === "right" ? deltaX > threshold : deltaX < -threshold;
      if (past) {
        triggered = true;
        onTrigger();
      }
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [direction, onTrigger, threshold, idleMs]);
}
