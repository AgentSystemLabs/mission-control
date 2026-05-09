import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "~/components/ui/Icon";
import { InstallSkillsModal } from "./InstallSkillsModal";
import { SkillsUpsellModal } from "./SkillsUpsellModal";
import { useLicense } from "~/queries";
import { isProTier } from "~/shared/license";
import {
  fetchInstalledSkillsVersion,
  fetchLatestSkillsManifest,
} from "~/lib/install-skills-client";

export function InstallSkillsButton({ projectPath }: { projectPath: string }) {
  const [open, setOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const { data: license } = useLicense();
  const isPro = !!license && isProTier(license);

  // Background check — never block the UI on these. Failures fall back to
  // showing "Install Skills" so the user always has a path forward.
  const installed = useQuery({
    queryKey: ["skills-installed", projectPath],
    queryFn: () => fetchInstalledSkillsVersion(projectPath),
    enabled: !!projectPath,
    retry: false,
    staleTime: 60_000,
  });
  const latest = useQuery({
    queryKey: ["skills-latest"],
    queryFn: () => fetchLatestSkillsManifest(),
    retry: false,
    staleTime: 60_000,
  });

  const installedVersion = installed.data?.version ?? null;
  const latestVersion = latest.data?.version ?? null;

  // Hide the button entirely once we know the project is on the latest version.
  const upToDate =
    !!installedVersion && !!latestVersion && installedVersion === latestVersion;
  if (upToDate) return null;

  const isUpdate = !!installedVersion && !!latestVersion && installedVersion !== latestVersion;
  const label = isUpdate ? "Update Skills" : "Install Skills";
  const title = isUpdate
    ? `Update from v${installedVersion} to v${latestVersion}`
    : "Install AgentSystem skills into this project";

  return (
    <>
      <button
        type="button"
        className="install-skills-theme-button"
        onClick={() => (isPro ? setOpen(true) : setPaywallOpen(true))}
        title={title}
      >
        <Icon name="sparkles" size={13} />
        {label}
      </button>
      <InstallSkillsModal
        open={open}
        onClose={() => {
          setOpen(false);
          void installed.refetch();
        }}
        projectPath={projectPath}
      />
      <SkillsUpsellModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
      />
    </>
  );
}
