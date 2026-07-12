import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { isFocusPath } from "~/lib/focus-session";
import { getElectron } from "~/lib/electron";
import { usePetOverlayEnabled } from "~/lib/pet/pet-overlay";
import { usePetController } from "~/lib/pet/use-pet-controller";
import { getPetPersistentState, subscribePetPersistence } from "~/lib/pet/pet-store";
import { PetWidget } from "~/components/pet/PetWidget";
import { RemotePets } from "~/components/pet/RemotePets";

// Lazy boundary for the whole Mission Pet cluster (controller + widget + the
// pet-lines/pet-messages/PetSprite payload it drags in). Mounted once as a
// sibling of the Shell so the headless controller keeps running across focus
// transitions — matching the previous placement of `usePetController` above the
// Shell's focus-mode early return, where XP kept accruing while the widget was
// hidden. The widget itself is suppressed on focus paths, mirroring the Shell
// which only rendered <PetWidget /> in its non-focus branch.
export default function PetHost() {
  // While the pet is unleashed onto the desktop overlay window, the main
  // window stands down entirely — the controller runs over there instead, so
  // XP/reactions aren't double-counted by two live controllers.
  const overlayEnabled = usePetOverlayEnabled();
  // …but design edits (species/size/name) still happen here in Settings, so
  // forward them to the overlay while it owns the live pet.
  useOverlayDesignBridge(overlayEnabled);
  if (overlayEnabled) return null;
  return <PetInWindow />;
}

/**
 * Push the pet's design (species/size/name) to the desktop overlay whenever it
 * changes, so an unleashed pet reflects Settings edits live. The main store
 * keeps its hydrated identity in memory even while its controller is unmounted,
 * so Settings edits still land here and fire the persistence subscription.
 */
function useOverlayDesignBridge(enabled: boolean) {
  useEffect(() => {
    const overlay = getElectron()?.petOverlay;
    if (!enabled || !overlay) return;
    const push = () => {
      const state = getPetPersistentState();
      if (state) {
        void overlay.applyDesign({
          species: state.species,
          size: state.size,
          name: state.name,
        });
      }
    };
    push(); // sync the current design the instant the pet is unleashed
    return subscribePetPersistence(push);
  }, [enabled]);
}

function PetInWindow() {
  usePetController();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  if (isFocusPath(pathname)) return null;
  return (
    <>
      <PetWidget />
      <RemotePets />
    </>
  );
}
