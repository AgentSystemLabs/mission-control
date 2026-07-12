import { useEffect } from "react";
import { getElectron } from "~/lib/electron";
import { usePetController } from "~/lib/pet/use-pet-controller";
import { petRename, petSetSize, petSetSpecies } from "~/lib/pet/pet-store";
import { isPetSizeId, isPetSpeciesId } from "~/shared/pet";
import { PetWidget } from "~/components/pet/PetWidget";

/**
 * Root of the pet DESKTOP OVERLAY window (the `?overlay=pet` renderer). Renders
 * only the pet — no app shell — on a fully transparent page that floats above
 * every other app. The controller runs here (not in the main window) while the
 * pet is unleashed, so XP/reactions keep flowing from the desktop.
 *
 * Click-through is owned by the OS (`setIgnoreMouseEvents` in the main
 * process). Because that's forwarded, we still get `mousemove` events here: we
 * hit-test the cursor against the sprite and flip the window interactive only
 * while it's over the pet, so clicks anywhere else fall through to the desktop.
 */
export function PetOverlayApp() {
  usePetController();
  useTransparentPage();
  useSpriteHitTest();
  useDesignFromMainWindow();
  return <PetWidget />;
}

/**
 * Apply design edits (species/size/name) forwarded from the main window's
 * Settings, so changing the pet's look updates the desktop pet live. The
 * targeted setters skip no-ops and never touch XP, so replays are harmless.
 */
function useDesignFromMainWindow() {
  useEffect(() => {
    const overlay = getElectron()?.petOverlay;
    if (!overlay) return;
    return overlay.onApplyDesign((patch) => {
      if (isPetSpeciesId(patch.species)) petSetSpecies(patch.species);
      if (isPetSizeId(patch.size)) petSetSize(patch.size);
      if (typeof patch.name === "string") petRename(patch.name);
    });
  }, []);
}

/** Force the page transparent so only the sprite paints over the desktop. */
function useTransparentPage() {
  useEffect(() => {
    const html = document.documentElement;
    const { body } = document;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    html.style.background = "transparent";
    body.style.background = "transparent";
    body.setAttribute("data-pet-overlay", "");
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
      body.removeAttribute("data-pet-overlay");
    };
  }, []);
}

/** Extra hit padding (px) around the sprite so it's easy to grab. */
const HIT_PAD_PX = 6;

/**
 * Toggle the overlay window between click-through and mouse-capturing based on
 * whether the cursor is over the pet button. While a drag is in progress the
 * window stays captured regardless, so a fast toss can't slip out of the
 * hit-box mid-motion.
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

    const overSprite = (x: number, y: number): boolean => {
      const btn = document.querySelector(".mc-pet-button");
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      return (
        x >= r.left - HIT_PAD_PX &&
        x <= r.right + HIT_PAD_PX &&
        y >= r.top - HIT_PAD_PX &&
        y <= r.bottom + HIT_PAD_PX
      );
    };

    const onMove = (e: MouseEvent) => {
      if (pointerActive) return;
      apply(overSprite(e.clientX, e.clientY));
    };
    // Once the window is interactive, real pointer events reach the sprite.
    const onDown = () => {
      pointerActive = true;
      apply(true);
    };
    const onUp = () => {
      pointerActive = false;
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onUp, { capture: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("pointercancel", onUp, { capture: true });
      void setInteractive(false);
    };
  }, []);
}
