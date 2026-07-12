import { useEffect } from "react";
import { getElectron } from "~/lib/electron";
import { petApplyMirror, petSetMirrorActionForwarder } from "~/lib/pet/pet-store";
import { PetWidget } from "~/components/pet/PetWidget";

/**
 * Root of the pet DESKTOP OVERLAY window (the `?overlay=pet` renderer). Renders
 * only the pet — no app shell — on a fully transparent page that floats above
 * every other app.
 *
 * The MAIN window owns the pet (store, controller, XP, persistence). This
 * window is a pure mirror: it adopts full snapshots pushed from the main
 * window and forwards every interaction (petting, drag, stats card…) back, so
 * exactly one store runs the logic and the two windows can never disagree.
 *
 * Click-through is owned by the OS (`setIgnoreMouseEvents` in the main
 * process). Because that's forwarded, we still get `mousemove` events here: we
 * hit-test the cursor against the sprite and flip the window interactive only
 * while it's over the pet, so clicks anywhere else fall through to the desktop.
 */
export function PetOverlayApp() {
  useMirrorFromMainWindow();
  useSpriteHitTest();
  return <PetWidget />;
}

/**
 * Adopt state pushed from the main window and forward this window's
 * interactions back to it. Registering the forwarder makes the pet store's
 * interaction setters (petStroke, petTossed, …) send an action instead of
 * mutating this mirror copy.
 */
function useMirrorFromMainWindow() {
  useEffect(() => {
    const overlay = getElectron()?.petOverlay;
    if (!overlay) return;
    petSetMirrorActionForwarder((action) => void overlay.sendAction(action));
    // Subscribe to live pushes FIRST, then pull the last state for the initial
    // paint (the overlay may have (re)loaded after the main window already sent
    // state). Ordering it this way means a push that lands between the fetch and
    // the subscription isn't missed, and petApplyMirror's seq guard drops the
    // getMirror reply if a newer push has already been applied.
    const unsubscribe = overlay.onMirror((payload) => petApplyMirror(payload));
    void overlay.getMirror().then((payload) => {
      if (payload) petApplyMirror(payload);
    });
    return () => {
      unsubscribe();
      petSetMirrorActionForwarder(null);
    };
  }, []);
}

// Page transparency is owned entirely by the pre-hydration script in
// __root.tsx, which sets `data-pet-overlay` on <html> and injects a
// `background: transparent !important` rule before the first paint — so there
// is no transparency effect here (an inline style couldn't override that
// !important rule anyway).

/** Extra hit padding (px) around the sprite so it's easy to grab. */
const HIT_PAD_PX = 6;

/**
 * Every interactive surface of the pet cluster. The sprite is the pet itself;
 * the stats card carries the close / molt buttons. The window must capture the
 * mouse over ALL of them, or a click on (say) the stats card's × falls through
 * the click-through overlay to the desktop behind it.
 */
const INTERACTIVE_SELECTORS = [".mc-pet-button", ".mc-pet-stats-card"] as const;

/**
 * Toggle the overlay window between click-through and mouse-capturing based on
 * whether the cursor is over any interactive pet surface (the sprite or its
 * stats card). While a drag is in progress the window stays captured
 * regardless, so a fast toss can't slip out of the hit-box mid-motion.
 */
function useSpriteHitTest() {
  useEffect(() => {
    const setInteractive = getElectron()?.petOverlay?.setInteractive;
    if (!setInteractive) return;

    let interactive = false;
    let pointerActive = false;
    const apply = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      void setInteractive(next);
    };

    const overInteractive = (x: number, y: number): boolean => {
      for (const selector of INTERACTIVE_SELECTORS) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (
          x >= r.left - HIT_PAD_PX &&
          x <= r.right + HIT_PAD_PX &&
          y >= r.top - HIT_PAD_PX &&
          y <= r.bottom + HIT_PAD_PX
        ) {
          return true;
        }
      }
      return false;
    };

    // The overlay is desktop-wide and click-through, so `mousemove` fires for
    // cursor motion ANYWHERE — even in other apps — and can arrive several
    // times per frame. Coalesce the querySelector + getBoundingClientRect
    // hit-test to at most once per animation frame on the latest coordinates.
    let rafId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const flush = () => {
      rafId = null;
      if (pointerActive) return;
      apply(overInteractive(lastX, lastY));
    };
    const onMove = (e: MouseEvent) => {
      if (pointerActive) return;
      lastX = e.clientX;
      lastY = e.clientY;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };
    // Once the window is interactive, real pointer events reach the sprite.
    const onDown = () => {
      pointerActive = true;
      apply(true);
    };
    const onUp = (e: PointerEvent) => {
      pointerActive = false;
      // Re-test immediately at the release point. A toss usually lands the pet
      // away from the cursor, so without this the window stays mouse-capturing
      // (blocking click-through to the desktop) until the next mousemove — and a
      // click right after release would hit the overlay instead of falling
      // through. onMove was suppressed during the drag, so lastX/lastY are stale.
      lastX = e.clientX;
      lastY = e.clientY;
      apply(overInteractive(e.clientX, e.clientY));
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onUp, { capture: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("pointercancel", onUp, { capture: true });
      void setInteractive(false);
    };
  }, []);
}
