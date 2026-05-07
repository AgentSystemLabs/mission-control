import { useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { InstallSkillsModal } from "./InstallSkillsModal";

// Always-visible menu entry that opens the Install Skills modal. Unlike
// InstallSkillsButton, this never hides itself based on freshness — the user
// might want to reinstall over a current version.
export function InstallSkillsMenuItem({
  projectPath,
  onOpen,
}: {
  projectPath: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn
        variant="ghost"
        icon="sparkles"
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
        style={{ justifyContent: "flex-start" }}
        title="Install or reinstall AgentSystem skills into this project"
      >
        Install Skills
      </Btn>
      <InstallSkillsModal
        open={open}
        onClose={() => setOpen(false)}
        projectPath={projectPath}
      />
    </>
  );
}
