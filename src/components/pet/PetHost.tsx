import { useRouterState } from "@tanstack/react-router";
import { isFocusPath } from "~/lib/focus-session";
import { usePetController } from "~/lib/pet/use-pet-controller";
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
