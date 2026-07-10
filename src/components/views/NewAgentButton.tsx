import { Btn } from "~/components/ui/Btn";
import { GridLayoutIcon } from "~/components/ui/GridLayoutIcon";
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
        onClick={onNewGrid}
        disabled={disabled}
        aria-label="New session grid — start several sessions at once"
        className={
          remembered
            ? "mc-btn-attached-left mc-btn-attached-right mc-btn-new-session-row"
            : "mc-btn-attached-left mc-btn-new-session-row"
        }
        style={{ minWidth: 52, paddingInline: 0 }}
      >
        {/* The layout glyph (3-per-row resting state, reflow morph on hover)
            with a plus badge — "create a shape of sessions" — so it reads as
            the grid sibling of the row-plus segment beside it, and stays
            distinct from both the 2x2 view toggle and the layout dropdown. */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <GridLayoutIcon active={false} size={14} />
          <span
            aria-hidden
            style={{
              position: "absolute",
              right: -4,
              bottom: -3,
              fontSize: 9,
              lineHeight: 1,
              fontWeight: 700,
              fontFamily: "var(--mono)",
            }}
          >
            +
          </span>
        </span>
      </Btn>
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
