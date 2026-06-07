import { Btn } from "./Btn";
import { isElectron } from "~/lib/electron";
import { openExternal } from "~/lib/open-external";
import { useLatestMissionControlVersion } from "~/queries/mission-control-version";
import {
  useAutoUpdaterState,
  canTriggerUpdateCheck,
  triggerUpdateDownload,
  triggerUpdateCheck,
  triggerUpdateInstall,
} from "~/queries/mc-auto-updater";

export function UpdateAvailableButton() {
  const updater = useAutoUpdaterState();
  const { data: academy } = useLatestMissionControlVersion();
  const downloadUpdate = async () => {
    const res = await triggerUpdateDownload();
    if (!res.ok) console.error("[updater] download failed:", res.error);
  };

  if (!isElectron()) return null;

  switch (updater.kind) {
    case "priming":
      // We don't know real state yet — render nothing rather than flicker an
      // "Update available" CTA that would mis-fire mid-prime.
      return null;

    case "checking":
      return (
        <Btn
          variant="primary"
          icon="refresh"
          aria-disabled="true"
          aria-busy="true"
          onClick={(e) => e.preventDefault()}
        >
          Checking…
        </Btn>
      );

    case "available":
      return (
        <Btn
          variant="primary"
          icon="download"
          onClick={() => void downloadUpdate()}
        >
          Download
        </Btn>
      );

    case "downloading": {
      const pct = Math.round(updater.percent);
      const label = pct < 1 ? "Starting download…" : `Downloading ${pct}%`;
      return (
        <Btn
          variant="primary"
          icon="upload"
          aria-disabled="true"
          aria-busy="true"
          onClick={(e) => e.preventDefault()}
        >
          {label}
        </Btn>
      );
    }

    case "ready-to-install":
      return (
        <Btn
          variant="primary"
          icon="refresh"
          onClick={async () => {
            const res = await triggerUpdateInstall();
            if (!res.ok && academy?.downloadUrl) {
              // Install couldn't quit the app. Surface manual fallback so the
              // user isn't stranded on "Restart to install" forever.
              const api = (window as any).electronAPI;
              if (api?.openExternal) void api.openExternal(academy.downloadUrl);
              else openExternal(academy.downloadUrl);
            }
          }}
        >
          Restart to install
        </Btn>
      );

    case "error":
    case "unsupported-dev":
    case "idle":
      // Fallback: if the auto-updater isn't doing anything but academy knows
      // about a newer release, surface "Update" — clicking it kicks off or
      // retries the updater. Dev builds still fall back to the browser because
      // electron-updater is intentionally disabled there.
      if (academy?.isUpdateAvailable && academy.latestVersion) {
        const onClick = async () => {
          if (canTriggerUpdateCheck(updater)) {
            try {
              await triggerUpdateCheck();
              return;
            } catch (err) {
              console.error("[updater] check failed; falling through to browser:", err);
            }
          }
          const api = (window as any).electronAPI;
          if (api?.openExternal) {
            void api.openExternal(academy.downloadUrl);
          } else {
            openExternal(academy.downloadUrl);
          }
        };
        return (
          <Btn variant="primary" icon="sparkles" onClick={onClick}>
            Update
          </Btn>
        );
      }
      return null;
  }
}
