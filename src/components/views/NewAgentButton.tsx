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
        <Btn
          variant="primary"
          icon="plus"
          onClick={onPrimary}
          disabled={disabled}
          className="mc-btn-new-session"
        >
          New session
        </Btn>
      </HotkeyTooltip>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
      <HotkeyTooltip
        action="agent.new"
        label={`Start ${project.savedAgent} session directly`}
      >
        <Btn
          variant="primary"
          icon="plus"
          onClick={onPrimary}
          disabled={disabled}
          className="mc-btn-attached-right mc-btn-new-session"
        >
          New session
        </Btn>
      </HotkeyTooltip>
      <Tooltip content="Change session settings">
        <Btn
          variant="ghost"
          icon="settings"
          onClick={onConfigure}
          disabled={disabled}
          aria-label="Change session settings"
          className="mc-btn-attached-left"
          style={{ minWidth: 52, paddingInline: 0 }}
        />
      </Tooltip>
    </div>
  );
}
