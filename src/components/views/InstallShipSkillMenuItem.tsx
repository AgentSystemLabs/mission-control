import { DropdownMenuItem } from "~/components/ui/DropdownMenuItem";

export function InstallShipSkillMenuItem({ onSelect }: { onSelect: () => void }) {
  return (
    <DropdownMenuItem
      icon="sparkles"
      onClick={onSelect}
      title="Install AgentSystem ship skills and subagents into this project"
    >
      Install ship skills
    </DropdownMenuItem>
  );
}
