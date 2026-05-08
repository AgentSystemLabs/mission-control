import { Btn } from "./Btn";
import { useLatestMissionControlVersion } from "~/queries/mission-control-version";

export function UpdateAvailableButton() {
  const { data } = useLatestMissionControlVersion();
  if (!data?.isUpdateAvailable || !data.latestVersion) return null;

  const onClick = () => {
    const api = (window as any).electronAPI;
    if (api?.openExternal) {
      void api.openExternal(data.downloadUrl);
    } else {
      window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Btn
      variant="primary"
      icon="sparkles"
      onClick={onClick}
      title={`New version v${data.latestVersion} available — click to download`}
    >
      Update available
    </Btn>
  );
}
