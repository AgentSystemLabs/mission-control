import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { getElectron } from "~/lib/electron";

type RouterLike = ReturnType<typeof useRouter>;

// Back/forward swipe navigation, applied globally, driven only by the explicit
// macOS 3-finger swipe (Electron's BrowserWindow `swipe` event). The two-finger
// horizontal wheel swipe (trackpad and, notably, the Magic Mouse) used to feed
// this too, but that gesture fires constantly and unintentionally — most visibly
// over non-scrolling areas like the header, where it isn't consumed for
// scrolling — popping the router mid-work. Since this is a single-shell app the
// accidental history steps are pure downside, so the wheel path is gone; the
// deliberate 3-finger swipe (opt-in via System Settings) stays.
const DISPATCH_COOLDOWN_MS = 400;

export function useNavigationSwipe() {
  const router = useRouter();

  useEffect(() => {
    const dispatch = makeDispatcher(router);

    const isNavigationBlocked = () =>
      document.querySelector("[data-modal-open], [data-navigation-swipe-blocker]") !== null;

    const offSwipe = getElectron()?.onSwipe((dir) => {
      if (isNavigationBlocked()) return;
      if (dir === "left") dispatch("back");
      else if (dir === "right") dispatch("forward");
    });

    return () => {
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
