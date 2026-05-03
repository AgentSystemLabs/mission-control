import { useRouter } from "@tanstack/react-router";
import { useProjects } from "~/queries";
import { ProjectIcon } from "~/components/ui/ProjectIcon";

const HOTKEY_LIMIT = 9;

export function ProjectBar() {
  const router = useRouter();
  const { data: projects } = useProjects();
  const pinned = (projects ?? []).filter((p) => p.pinned);

  if (pinned.length === 0) return null;

  const activeId = router.state.location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const modSymbol = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div
      role="navigation"
      aria-label="Pinned projects"
      style={{
        width: 56,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "10px 0",
        background: "var(--surface-0)",
        borderRight: "1px solid var(--border)",
        overflowY: "auto",
      }}
    >
      {pinned.map((project, idx) => {
        const hotkey = idx < HOTKEY_LIMIT ? idx + 1 : null;
        const isActive = activeId === project.id;
        const tooltip = hotkey ? `${project.name} (${modSymbol}${hotkey})` : project.name;
        return (
          <button
            key={project.id}
            type="button"
            title={tooltip}
            aria-label={tooltip}
            onClick={() =>
              router.navigate({ to: "/projects/$id", params: { id: project.id } })
            }
            style={{
              position: "relative",
              width: 40,
              height: 40,
              padding: 0,
              border: `1px solid ${isActive ? "var(--accent-border)" : "transparent"}`,
              borderRadius: 10,
              background: isActive ? "var(--accent-dim)" : "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = "var(--surface-2)";
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = "transparent";
            }}
          >
            <ProjectIcon project={project} size={36} />
            {hotkey && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  bottom: -2,
                  right: -2,
                  minWidth: 14,
                  height: 14,
                  padding: "0 3px",
                  borderRadius: 4,
                  background: "var(--surface-3, var(--surface-2))",
                  border: "1px solid var(--border)",
                  color: "var(--text-faint)",
                  fontFamily: "var(--mono)",
                  fontSize: 9,
                  lineHeight: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {hotkey}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
