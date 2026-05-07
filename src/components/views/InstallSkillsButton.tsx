import { useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { InstallSkillsModal } from "./InstallSkillsModal";

export function InstallSkillsButton({ projectPath }: { projectPath: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn
        variant="ghost"
        icon="sparkles"
        onClick={() => setOpen(true)}
        title="Install AgentSystem skills into this project"
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
