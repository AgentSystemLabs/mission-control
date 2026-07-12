import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { isFocusPath } from "~/lib/focus-session";
import { getElectron } from "~/lib/electron";
import { usePetOverlayEnabled } from "~/lib/pet/pet-overlay";
import { usePetController } from "~/lib/pet/use-pet-controller";
import { useSettings } from "~/queries";
import {
  getPetPersistentState,
  getPetSnapshot,
  petGrabbed,
  petInteract,
  petMolt,
  petSetStatsOpen,
  petStroke,
  petTossed,
  subscribePetSnapshot,
} from "~/lib/pet/pet-store";
import { PetWidget } from "~/components/pet/PetWidget";
import { RemotePets } from "~/components/pet/RemotePets";
import { usePetAlertNavigate } from "~/components/pet/use-pet-alert-navigate";

// Lazy boundary for the whole Mission Pet cluster (controller + widget + the
// pet-lines/pet-messages/PetSprite payload it drags in). Mounted once as a
// sibling of the Shell so the headless controller keeps running across focus
// transitions — matching the previous placement of `usePetController` above the
// Shell's focus-mode early return, where XP kept accruing while the widget was
// hidden. The widget itself is suppressed on focus paths, mirroring the Shell
// which only rendered <PetWidget /> in its non-focus branch.
export default function PetHost() {
  // This window's store stays the single source of truth even while the pet
  // is unleashed onto the desktop overlay: the controller keeps running here,
  // the overlay only renders mirrored state and forwards interactions back.
  const overlayEnabled = usePetOverlayEnabled();
  usePetOverlaySettingSync();
  usePetOverlayMirrorBridge(overlayEnabled);
  return <PetInWindow widgetHidden={overlayEnabled} />;
}

/**
 * Keep the desktop overlay window in step with the persisted `petOverlayEnabled`
 * app setting — the setting is the source of truth for the Unleash toggle, so
 * an unleashed pet comes back on the next launch.
 */
function usePetOverlaySettingSync() {
  const settings = useSettings().data;
  const loaded = settings !== undefined;
  const desired = loaded && (settings?.petEnabled ?? false) && (settings?.petOverlayEnabled ?? false);
  useEffect(() => {
    const overlay = getElectron()?.petOverlay;
    if (!overlay || !loaded) return;
    void overlay.setEnabled(desired);
    // Reconcile if the overlay window goes away out-of-band (renderer crash, OS
    // teardown): its state broadcast flips to disabled while the setting still
    // wants it on, so re-open now instead of waiting for the next launch. When
    // the setting itself is off, `desired` is false and we never re-open, so an
    // intentional close doesn't loop.
    return overlay.onStateChange((state) => {
      if (desired && !state.enabled) void overlay.setEnabled(true);
    });
  }, [loaded, desired]);
}

/**
 * While the pet is unleashed: push every snapshot/identity change to the
 * overlay window (which renders it verbatim), and apply the interactions it
 * forwards back — petting, stroking, drag/toss, the stats card, molting — to
 * this store, so XP and reactions accrue in exactly one place.
 */
function usePetOverlayMirrorBridge(enabled: boolean) {
  const navigateToAlert = usePetAlertNavigate();

  useEffect(() => {
    const overlay = getElectron()?.petOverlay;
    if (!enabled || !overlay) return;
    // The identity object (personality, stats, project-XP map) is deep and
    // rarely changes; `persistent` is only reassigned on real progression
    // (XP, rename, species, molt…), so a reference check tells us when to send
    // it. `undefined` on (re)mount forces the first push to carry it.
    let lastIdentity: ReturnType<typeof getPetPersistentState> | undefined;
    const push = () => {
      const snapshot = getPetSnapshot();
      const identity = getPetPersistentState();
      // Omit the unchanged identity from snapshot-only pushes so the frequent
      // wander/flourish/stroke ticks don't re-clone the whole blob twice.
      void overlay.pushMirror(identity === lastIdentity ? { snapshot } : { snapshot, identity });
      lastIdentity = identity;
    };
    push(); // paint the overlay the instant it takes over
    // Identity edits (rename, species, XP) also invalidate the snapshot, so
    // one subscription covers both halves of the payload.
    return subscribePetSnapshot(push);
  }, [enabled]);

  useEffect(() => {
    const overlay = getElectron()?.petOverlay;
    if (!enabled || !overlay) return;
    return overlay.onAction((action) => {
      switch (action.kind) {
        case "interact": {
          const { navigateTo } = petInteract();
          if (navigateTo) navigateToAlert(navigateTo);
          break;
        }
        case "stroke":
          petStroke();
          break;
        case "grabbed":
          petGrabbed(action.x);
          break;
        case "tossed":
          petTossed(action.x);
          break;
        case "stats-open":
          petSetStatsOpen(action.open);
          break;
        case "molt":
          petMolt();
          break;
      }
    });
  }, [enabled, navigateToAlert]);
}

function PetInWindow({ widgetHidden }: { widgetHidden: boolean }) {
  usePetController();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  // Unleashed (the overlay renders the pet) or focus mode: controller only.
  if (widgetHidden || isFocusPath(pathname)) return null;
  return (
    <>
      <PetWidget />
      <RemotePets />
    </>
  );
}
