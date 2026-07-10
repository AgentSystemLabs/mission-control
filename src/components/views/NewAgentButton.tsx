import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip, Tooltip } from "~/components/ui/Tooltip";
import type { Project } from "~/db/schema";

export function NewAgentButton({
  project,
  onPrimary,
  onConfigure,
  onNewRow,
  onNewGrid,
  disabled,
}: {
  project: Project;
  onPrimary: () => void;
  onConfigure: () => void;
  /** When set (grid view), adds a segment that starts the session in a fresh grid row. */
  onNewRow?: () => void;
  /** When set (grid view), adds a segment that opens the batch grid-shape launcher. */
  onNewGrid?: () => void;
  disabled?: boolean;
}) {
  const remembered = !!(project.rememberAgentSettings && project.savedAgent);

  const newRowSegment = onNewRow && (
    <HotkeyTooltip action="session.newRow" label="New session in a new row">
      <Btn
        variant="ghost"
        icon="row-plus"
        onClick={onNewRow}
        disabled={disabled}
        aria-label="New session in a new row"
        className={
          remembered || onNewGrid
            ? "mc-btn-attached-left mc-btn-attached-right mc-btn-new-session-row"
            : "mc-btn-attached-left mc-btn-new-session-row"
        }
        style={{ minWidth: 52, paddingInline: 0 }}
      />
    </HotkeyTooltip>
  );

  const newGridSegment = onNewGrid && (
    <Tooltip content="New session grid — start several sessions at once">
      <Btn
        variant="ghost"
        icon="grid"
        onClick={onNewGrid}
        disabled={disabled}
        aria-label="New session grid — start several sessions at once"
        className={
          remembered
            ? "mc-btn-attached-left mc-btn-attached-right mc-btn-new-session-row"
            : "mc-btn-attached-left mc-btn-new-session-row"
        }
        style={{ minWidth: 52, paddingInline: 0 }}
      />
    </Tooltip>
  );

  if (!remembered) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
        <HotkeyTooltip action="agent.new">
          <Btn
            variant="primary"
            icon="plus"
            onClick={onPrimary}
            disabled={disabled}
            className={
              onNewRow || onNewGrid
                ? "mc-btn-attached-right mc-btn-new-session"
                : "mc-btn-new-session"
            }
          >
            New session
          </Btn>
        </HotkeyTooltip>
        {newRowSegment}
        {newGridSegment}
      </div>
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
      {newRowSegment}
      {newGridSegment}
      <Tooltip content="Change session settings">
        <Btn
          variant="ghost"
          icon="settings"
          onClick={onConfigure}
          disabled={disabled}
          aria-label="Change session settings"
          className="mc-btn-attached-left mc-btn-new-session-config"
          style={{ minWidth: 52, paddingInline: 0 }}
        />
      </Tooltip>
    </div>
  );
}
