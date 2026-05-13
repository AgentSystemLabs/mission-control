import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";

export function ProjectGitStatusButton({
  branch,
  changedCount,
  onClick,
}: {
  branch: string;
  changedCount: number | undefined;
  onClick: () => void;
}) {
  const changedLabel =
    changedCount === undefined
      ? "Checking…"
      : `${changedCount} ${changedCount === 1 ? "Change" : "Changes"}`;
  const title =
    changedCount === undefined
      ? `Open Review Changes · branch ${branch}`
      : `Open Review Changes · ${changedCount} changed file${changedCount === 1 ? "" : "s"} · branch ${branch}`;

  return (
    <HotkeyTooltip action="git.diff" label={title}>
      <Btn
        variant="ghost"
        icon="git-branch"
        onClick={onClick}
        aria-label={title}
        className="mc-btn-attached-right"
        style={{ fontFamily: "var(--mono)", maxWidth: 320, minWidth: 0 }}
      >
        <span
          style={{
            color: changedCount && changedCount > 0 ? "var(--accent)" : "var(--text-dim)",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {changedLabel}
        </span>
      </Btn>
    </HotkeyTooltip>
  );
}
