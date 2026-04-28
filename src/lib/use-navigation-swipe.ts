import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { getElectron } from "~/lib/electron";

// Browser-like back/forward swipe navigation, applied globally.
// Two-finger trackpad horizontal wheel swipe (any platform) and macOS 3-finger
// swipe via Electron both call router.history back/forward — so every route
// gets web-standard navigation gestures without opting in.
export function useNavigationSwipe(threshold = 250, idleMs = 250) {
  const router = useRouter();

  useEffect(() => {
    let deltaX = 0;
    let triggered = false;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const isModalOpen = () =>
      document.querySelector("[data-modal-open]") !== null;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (isModalOpen()) return;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        deltaX = 0;
        triggered = false;
      }, idleMs);
      if (triggered) return;
      deltaX += e.deltaX;
      if (deltaX < -threshold) {
        triggered = true;
        router.history.back();
      } else if (deltaX > threshold) {
        triggered = true;
        router.history.forward();
      }
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [router, threshold, idleMs]);

  useEffect(() => {
    const off = getElectron()?.onSwipe((dir) => {
      if (document.querySelector("[data-modal-open]")) return;
      if (dir === "left") router.history.back();
      else if (dir === "right") router.history.forward();
    });
    return () => {
      off?.();
    };
  }, [router]);
}
