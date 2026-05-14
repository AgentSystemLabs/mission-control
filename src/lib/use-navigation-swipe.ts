import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { getRuntime } from "~/lib/runtime";

type RouterLike = ReturnType<typeof useRouter>;

// Browser-like back/forward swipe navigation, applied globally.
// Two-finger trackpad horizontal wheel swipe and macOS 3-finger swipe (via
// Electron's BrowserWindow `swipe` event) both feed a single dispatcher so
// one physical gesture = one history step, regardless of how many event
// streams the OS routes to us.
const DISPATCH_COOLDOWN_MS = 400;
const WHEEL_THRESHOLD = 60;
const WHEEL_IDLE_MS = 180;

export function useNavigationSwipe() {
  const router = useRouter();

  useEffect(() => {
    const dispatch = makeDispatcher(router);

    const isNavigationBlocked = () =>
      document.querySelector("[data-modal-open], [data-navigation-swipe-blocker]") !== null;

    let wheelSum = 0;
    let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (isNavigationBlocked()) return;

      // Accumulate signed deltaX across the gesture so slow steady swipes
      // (many small deltas) still cross the threshold. The dispatcher's
      // 400ms cooldown absorbs inertial tail events after we fire.
      wheelSum += e.deltaX;

      if (wheelIdleTimer) clearTimeout(wheelIdleTimer);
      wheelIdleTimer = setTimeout(() => {
        wheelSum = 0;
      }, WHEEL_IDLE_MS);

      if (wheelSum <= -WHEEL_THRESHOLD) {
        dispatch("back");
        wheelSum = 0;
      } else if (wheelSum >= WHEEL_THRESHOLD) {
        dispatch("forward");
        wheelSum = 0;
      }
    };

    window.addEventListener("wheel", onWheel, { passive: true });

    const offSwipe = getRuntime()?.onSwipe((dir) => {
      if (isNavigationBlocked()) return;
      if (dir === "left") dispatch("back");
      else if (dir === "right") dispatch("forward");
    });

    return () => {
      window.removeEventListener("wheel", onWheel);
      if (wheelIdleTimer) clearTimeout(wheelIdleTimer);
      offSwipe?.();
    };
  }, [router]);
}

function makeDispatcher(router: RouterLike) {
  let lastAt = 0;
  return (dir: "back" | "forward") => {
    const now = performance.now();
    if (now - lastAt < DISPATCH_COOLDOWN_MS) return;
    lastAt = now;
    if (dir === "back") router.history.back();
    else router.history.forward();
  };
}
