import { useCallback } from "react";
import { getElectron } from "~/lib/electron";

type CloneOffer = { remote: string; slug: string } | null;

/**
 * The "clone repo, then retry" confirm handler shared by the agent and user
 * terminal panes: clone the offered remote into the sandbox, clear the offer,
 * and bump `retryNonce` so the pane re-runs (repo now present). Clone failures
 * surface via `setStartError`; `setCloning` toggles around the call.
 */
export function useSandboxCloneConfirm({
  cloneOffer,
  setCloneOffer,
  setCloning,
  setStartError,
  setRetryNonce,
}: {
  cloneOffer: CloneOffer;
  setCloneOffer: (offer: CloneOffer) => void;
  setCloning: (cloning: boolean) => void;
  setStartError: (error: string | null) => void;
  setRetryNonce: (updater: (n: number) => number) => void;
}) {
  return useCallback(async () => {
    const electron = getElectron();
    if (!electron || !cloneOffer) return;
    setCloning(true);
    setStartError(null);
    try {
      await electron.remoteGit.clone(cloneOffer.remote, cloneOffer.slug);
      setCloneOffer(null);
      setRetryNonce((n) => n + 1); // re-run: repo now present → the agent spawns
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  }, [cloneOffer, setCloneOffer, setCloning, setStartError, setRetryNonce]);
}
