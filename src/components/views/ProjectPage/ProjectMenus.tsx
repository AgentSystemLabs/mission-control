import { useEffect, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { InstallSkillsMenuItem } from "~/components/views/InstallSkillsMenuItem";
import { getRuntime } from "~/lib/runtime";
import { DEFAULT_BRANCH } from "~/shared/domain";
import type { Project } from "~/db/schema";
import type { GitStatus } from "~/server/services/git";

function MenuSeparator() {
  return (
    <div
      style={{
        height: 1,
        background: "var(--border)",
        margin: "4px 2px",
      }}
    />
  );
}

export function ProjectMenus({
  project,
  gitStatus,
  gitAvailable,
  hasRunningLaunch,
  stopping,
  stopLaunch,
  pinning,
  toggleProjectPin,
  openDiffView,
  setShowLaunchConfig,
  setShowEdit,
  setConfirmRemove,
}: {
  project: Project;
  gitStatus: GitStatus | undefined;
  gitAvailable: boolean;
  hasRunningLaunch: boolean;
  stopping: boolean;
  stopLaunch: () => Promise<void> | void;
  pinning: boolean;
  toggleProjectPin: () => Promise<void> | void;
  openDiffView: () => void;
  setShowLaunchConfig: (v: boolean) => void;
  setShowEdit: (v: boolean) => void;
  setConfirmRemove: (v: boolean) => void;
}) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!overflowRef.current?.contains(e.target as Node)) setOverflowOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  return (
    <div ref={overflowRef} style={{ position: "relative", minWidth: 0, flex: "0 1 auto" }}>
      <button
        onClick={() => setOverflowOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={overflowOpen}
        title="Project actions"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          padding: "6px 10px 6px 6px",
          background: "none",
          border: "1px solid transparent",
          borderRadius: 10,
          cursor: "pointer",
          color: "var(--text)",
          maxWidth: "100%",
          minWidth: 0,
          transition: "background 0.12s, border-color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-2)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          e.currentTarget.style.borderColor = "transparent";
        }}
      >
        <ProjectIcon project={project} size={32} />
        <h1
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
          title={project.name}
        >
          {project.name}
        </h1>
        <Icon
          name="chevron-down"
          size={14}
          style={{ color: "var(--text-dim)", flexShrink: 0 }}
        />
      </button>
      {overflowOpen && (
        <CardFrame
          role="menu"
          solid
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 220,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 2,
            boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
            zIndex: 100,
          }}
        >
          {hasRunningLaunch ? (
            <>
              <HotkeyTooltip action="project.runToggle">
                <Btn
                  variant="ghost"
                  icon="x"
                  onClick={() => {
                    setOverflowOpen(false);
                    void stopLaunch();
                  }}
                  disabled={stopping}
                  style={{ justifyContent: "flex-start" }}
                >
                  {stopping ? "Stopping…" : "Stop launch"}
                </Btn>
              </HotkeyTooltip>
              <MenuSeparator />
            </>
          ) : null}
          <Btn
            variant="ghost"
            icon={project.pinned ? "pin-fill" : "pin"}
            onClick={() => {
              setOverflowOpen(false);
              void toggleProjectPin();
            }}
            disabled={pinning}
            style={{ justifyContent: "flex-start" }}
          >
            {pinning
              ? project.pinned
                ? "Unpinning..."
                : "Pinning..."
              : project.pinned
                ? "Unpin project"
                : "Pin project"}
          </Btn>
          {project.runtimeKind === "local" ? (
            <Btn
              variant="ghost"
              icon="folder"
              onClick={() => {
                setOverflowOpen(false);
                // openPath is project-scoped; "." opens the project root.
                void getRuntime()?.openPath(project.id, ".");
              }}
              style={{ justifyContent: "flex-start" }}
              title={project.path}
            >
              Reveal in Finder
            </Btn>
          ) : null}
          {project.githubUrl && (
            <Btn
              variant="ghost"
              icon="github"
              onClick={() => {
                setOverflowOpen(false);
                window.open(project.githubUrl!, "_blank", "noopener,noreferrer");
              }}
              style={{ justifyContent: "flex-start" }}
            >
              Open GitHub
            </Btn>
          )}
          {gitAvailable ? (
            <HotkeyTooltip action="git.diff">
              <Btn
                variant="ghost"
                icon="git-branch"
                onClick={() => {
                  setOverflowOpen(false);
                  openDiffView();
                }}
                style={{ justifyContent: "flex-start" }}
                title={(() => {
                  const b = gitStatus?.branch ?? project.branch ?? DEFAULT_BRANCH;
                  if (gitStatus && gitStatus.changedCount > 0) {
                    return `Branch ${b} · ${gitStatus.changedCount} changed file${gitStatus.changedCount === 1 ? "" : "s"}`;
                  }
                  return `Branch ${b}`;
                })()}
              >
                <span style={{ flex: 1, textAlign: "left" }}>
                  Review Changes
                  {gitStatus && gitStatus.changedCount > 0 && (
                    <span style={{ color: "var(--text-dim)" }}>
                      {" · "}
                      {gitStatus.changedCount} changed
                    </span>
                  )}
                </span>
              </Btn>
            </HotkeyTooltip>
          ) : null}
          <MenuSeparator />
          <Btn
            variant="ghost"
            icon="play"
            onClick={() => {
              setOverflowOpen(false);
              setShowLaunchConfig(true);
            }}
            style={{ justifyContent: "flex-start" }}
          >
            Configure launch commands
          </Btn>
          {project.runtimeKind === "local" ? (
            <InstallSkillsMenuItem
              projectId={project.id}
              onOpen={() => setOverflowOpen(false)}
            />
          ) : null}
          <HotkeyTooltip action="project.edit">
            <Btn
              variant="ghost"
              icon="settings"
              onClick={() => {
                setOverflowOpen(false);
                setShowEdit(true);
              }}
              style={{ justifyContent: "flex-start" }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>Edit project</span>
            </Btn>
          </HotkeyTooltip>
          <MenuSeparator />
          <Btn
            variant="ghost"
            icon="trash"
            onClick={() => {
              setOverflowOpen(false);
              setConfirmRemove(true);
            }}
            style={{ justifyContent: "flex-start" }}
            title="Remove this project from Mission Control. The folder on disk is not touched."
          >
            Remove project
          </Btn>
        </CardFrame>
      )}
    </div>
  );
}
