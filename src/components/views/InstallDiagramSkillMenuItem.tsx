import { Btn } from "~/components/ui/Btn";

export function InstallDiagramSkillMenuItem({ onSelect }: { onSelect: () => void }) {
  return (
    <Btn
      variant="ghost"
      icon="chart"
      onClick={onSelect}
      style={{ justifyContent: "flex-start" }}
      title="Install the Mission Control diagram skill into this project"
    >
      Install diagram skill
    </Btn>
  );
}
