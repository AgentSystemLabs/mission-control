import { Btn } from "~/components/ui/Btn";
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
      style={{ display: "inline-flex", alignItems: "center", gap: 0 }}
    >
      <Tooltip content="Card view">
        <Btn
          variant={view === "cards" ? "primary" : "ghost"}
          icon="grid"
          aria-label="Card view"
          aria-pressed={view === "cards"}
          className="mc-btn-attached-right"
          style={{ minWidth: 52, paddingInline: 0 }}
          onClick={() => onChange("cards")}
        />
      </Tooltip>
      <Tooltip content="Table view">
        <Btn
          variant={view === "table" ? "primary" : "ghost"}
          icon="list"
          aria-label="Table view"
          aria-pressed={view === "table"}
          className="mc-btn-attached-left"
          style={{ minWidth: 52, paddingInline: 0 }}
          onClick={() => onChange("table")}
        />
      </Tooltip>
    </div>
  );
}
