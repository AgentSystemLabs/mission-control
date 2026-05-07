import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { InstallSkillsModal } from "./InstallSkillsModal";
import {
  fetchInstalledSkillsVersion,
  fetchLatestSkillsManifest,
} from "~/lib/install-skills-client";

export function InstallSkillsButton({ projectPath }: { projectPath: string }) {
  const [open, setOpen] = useState(false);

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
      <Btn
        variant="ghost"
        icon="sparkles"
        onClick={() => setOpen(true)}
        title={title}
      >
        {label}
      </Btn>
      <InstallSkillsModal
        open={open}
        onClose={() => {
          setOpen(false);
          void installed.refetch();
        }}
        projectPath={projectPath}
      />
    </>
  );
}
