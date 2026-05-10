import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip, Tooltip } from "~/components/ui/Tooltip";
import type { Project } from "~/db/schema";

export function NewAgentButton({
  project,
  onPrimary,
  onConfigure,
  disabled,
}: {
  project: Project;
  onPrimary: () => void;
  onConfigure: () => void;
  disabled?: boolean;
}) {
  const remembered = !!(project.rememberAgentSettings && project.savedAgent);

  if (!remembered) {
    return (
      <HotkeyTooltip action="agent.new">
        <Btn variant="primary" icon="plus" onClick={onPrimary} disabled={disabled}>
          New session
        </Btn>
      </HotkeyTooltip>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <HotkeyTooltip
        action="agent.new"
        label={`Start ${project.savedAgent} session directly`}
      >
        <Btn
          variant="primary"
          icon="plus"
          onClick={onPrimary}
          disabled={disabled}
        >
          New session
        </Btn>
      </HotkeyTooltip>
      <Tooltip content="Change session settings">
        <Btn
          variant="primary"
          icon="settings"
          onClick={onConfigure}
          disabled={disabled}
          aria-label="Change session settings"
          style={{ minWidth: 52, paddingInline: 0 }}
        />
      </Tooltip>
    </div>
  );
}
