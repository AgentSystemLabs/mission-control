import { useCallback, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useProjects, queryKeys } from "~/queries";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { ProjectRunningDot } from "~/components/ui/ProjectRunningDot";
import { Icon } from "~/components/ui/Icon";
import { CardFrame } from "~/components/ui/CardFrame";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { api } from "~/lib/api";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { getProjectActivity, isProjectActive } from "~/shared/projects";

const HOTKEY_LIMIT = 9;

export function ProjectBar() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { runningProjectIds } = useUserTerminals();
  const pinned = (projects ?? []).filter((p) => p.pinned);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; name: string } | null>(
    null
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismissableMenu(menu !== null, closeMenu);

  if (pinned.length === 0) return null;

  const activeId = router.state.location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const activeIndex = pinned.findIndex((p) => p.id === activeId);
  const modSymbol = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

  const ITEM = 40;
  const GAP = 8;
  const PAD_TOP = 10;

  return (
    <CardFrame
      glow
      role="navigation"
      aria-label="Pinned projects"
      style={{
        width: 88,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "10px 0",
        overflowX: "hidden",
        overflowY: "auto",
      }}
    >
      {activeIndex >= 0 && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: PAD_TOP,
            left: "50%",
            width: ITEM,
            height: ITEM,
            marginLeft: -ITEM / 2,
            borderRadius: 10,
            border: "2px solid color-mix(in srgb, var(--accent) 88%, black)",
            background: "transparent",
            transform: `translateY(${activeIndex * (ITEM + GAP)}px)`,
            transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      )}
      {pinned.map((project, idx) => {
        const hotkey = idx < HOTKEY_LIMIT ? idx + 1 : null;
        const isActive = activeId === project.id;
        const runningCount = project.taskCounts.running;
        const isRunning = isProjectActive(getProjectActivity(project, runningProjectIds));
        const runningLabel =
          runningCount > 0
            ? `${runningCount} ${runningCount === 1 ? "agent" : "agents"} running`
            : null;
        const tooltip = [
          hotkey ? `${project.name} (${modSymbol}${hotkey})` : project.name,
          runningLabel,
        ]
          .filter(Boolean)
          .join(" — ");
        return (
          <button
            key={project.id}
            type="button"
            title={tooltip}
            aria-label={tooltip}
            onClick={() =>
              router.navigate({ to: "/projects/$id", params: { id: project.id } })
            }
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, id: project.id, name: project.name });
            }}
            style={{
              position: "relative",
              width: 40,
              height: 40,
              flexShrink: 0,
              aspectRatio: "1 / 1",
              padding: 0,
              border: "1px solid transparent",
              borderRadius: 10,
              background: "transparent",
              zIndex: 1,
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
            {runningCount > 0 && (
              <span
                aria-label={runningLabel ?? undefined}
                style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  height: 14,
                  padding: "0 4px",
                  borderRadius: 7,
                  background: "var(--surface-3, var(--surface-2))",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontFamily: "var(--mono)",
                  fontSize: 9,
                  lineHeight: "12px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <ProjectRunningDot running={isRunning} size={6} />
                {runningCount}
              </span>
            )}
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
      {menu && (
        <div
          role="menu"
          aria-label={`${menu.name} actions`}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menu.y,
            left: menu.x,
            zIndex: 1000,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 4,
            minWidth: 140,
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={async (e) => {
              e.stopPropagation();
              const id = menu.id;
              setMenu(null);
              await api.togglePin(id);
              await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "7px 10px",
              background: "transparent",
              border: 0,
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "var(--mono)",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Icon name="pin" size={12} /> Unpin
          </button>
        </div>
      )}
    </CardFrame>
  );
}
