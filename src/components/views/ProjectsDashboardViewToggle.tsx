import { Icon } from "~/components/ui/Icon";
import { Tooltip } from "~/components/ui/Tooltip";
import type { ProjectsDashboardView } from "~/shared/ui-preferences";

export function ProjectsDashboardViewToggle({
  view,
  onChange,
}: {
  view: ProjectsDashboardView;
  onChange: (view: ProjectsDashboardView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Projects layout"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: 2,
        border: "1px solid var(--border)",
        borderRadius: 5,
        background: "var(--surface-1)",
        flexShrink: 0,
      }}
    >
      <Tooltip content="Card view">
        <ProjectsDashboardViewButton
          icon="grid"
          label="Card view"
          active={view === "cards"}
          onClick={() => onChange("cards")}
        />
      </Tooltip>
      <Tooltip content="Table view">
        <ProjectsDashboardViewButton
          icon="list"
          label="Table view"
          active={view === "table"}
          onClick={() => onChange("table")}
        />
      </Tooltip>
    </div>
  );
}

function ProjectsDashboardViewButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: "grid" | "list";
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        width: 34,
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: 0,
        borderRadius: 4,
        background: active ? "var(--surface-3)" : "transparent",
        color: active ? "var(--text)" : "var(--text-dim)",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}
