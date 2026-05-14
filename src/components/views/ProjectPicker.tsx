import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { ProjectRunningDot } from "~/components/ui/ProjectRunningDot";
import { StatusDot } from "~/components/ui/StatusDot";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { InstallSkillsMenuItem } from "~/components/views/InstallSkillsMenuItem";
import { projectPickerSections } from "~/lib/group-projects";
import { getRuntime } from "~/lib/runtime";
import { DEFAULT_BRANCH, TASK_STATUS_META, type TaskStatus } from "~/shared/domain";
import { useServerEvents } from "~/lib/use-events";
import { isEditableTarget, useHotkey } from "~/lib/use-hotkey";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { queryKeys, useGroups, useProjects } from "~/queries";
import type { Project } from "~/db/schema";
import type { GitStatus } from "~/server/services/git";
import { getProjectActivity, isProjectActive, type ProjectWithCounts } from "~/shared/projects";

function DotCount({ status, count, size }: { status: TaskStatus; count: number; size: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: TASK_STATUS_META[status].color }}>
      <StatusDot status={status} size={size} />
      <span>{count}</span>
    </span>
  );
}

function ActivityCounts({ project, size = 6 }: { project: ProjectWithCounts; size?: number }) {
  const running = project.taskCounts.running;
  const needs = project.taskCounts["needs-input"];
  const interrupted = project.taskCounts.interrupted;
  if (!running && !needs && !interrupted) return null;
  const title = [
    interrupted ? `${interrupted} ${interrupted === 1 ? "task interrupted" : "tasks interrupted"}` : null,
    needs ? `${needs} ${needs === 1 ? "task needs input" : "tasks need input"}` : null,
    running ? `${running} ${running === 1 ? "session running" : "sessions running"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {interrupted > 0 && <DotCount status="interrupted" count={interrupted} size={size} />}
      {needs > 0 && <DotCount status="needs-input" count={needs} size={size} />}
      {running > 0 && <DotCount status="running" count={running} size={size} />}
    </span>
  );
}

function MenuSeparator() {
  return (
    <div
      style={{
        height: 1,
        background: "var(--border)",
        margin: "4px 6px",
      }}
    />
  );
}

type ProjectPickerActions = {
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
};

type ProjectPickerActionsContextValue = {
  actions: ProjectPickerActions | null;
  setActions: Dispatch<SetStateAction<ProjectPickerActions | null>>;
};

const ProjectPickerActionsContext = createContext<ProjectPickerActionsContextValue>({
  actions: null,
  setActions: () => {},
});

export function ProjectPickerActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ProjectPickerActions | null>(null);
  return (
    <ProjectPickerActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </ProjectPickerActionsContext.Provider>
  );
}

export function useProjectPickerActions(actions: ProjectPickerActions | null) {
  const { setActions } = useContext(ProjectPickerActionsContext);

  useEffect(() => {
    setActions(actions);
    return () => {
      setActions((current) =>
        current?.project.id === actions?.project.id ? null : current
      );
    };
  }, [actions, setActions]);
}

export function ProjectPicker({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { actions } = useContext(ProjectPickerActionsContext);
  const { runningProjectIds } = useUserTerminals();
  const [open, setOpen] = useState(false);
  const { data: projects } = useProjects();
  const { data: groups = [] } = useGroups();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const current = projects?.find((p) => p.id === projectId) ?? null;
  const label = current?.name ?? "Project";
  const currentActions =
    current && actions?.project.id === current.id ? actions : null;

  const filtered = useMemo<ProjectWithCounts[]>(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  // Mirrors the landing page layout so the affordance is consistent.
  const sections = useMemo(() => projectPickerSections(filtered, groups), [filtered, groups]);

  // Flat list of selectable items, in render order — drives keyboard nav indexing.
  const flatItems = useMemo(() => sections.flatMap((s) => s.projects), [sections]);

  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("project:") || e.type.startsWith("task:")) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
        }
        if (e.type.startsWith("group:")) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        }
      },
      [queryClient],
    ),
  );

  const select = (id: string) => {
    setOpen(false);
    setQuery("");
    if (id !== projectId) router.navigate({ to: "/projects/$id", params: { id } });
  };

  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => {
      const trigger = wrapRef.current?.querySelector("button");
      if (trigger instanceof HTMLButtonElement) trigger.focus();
    }, 0);
  }, []);

  useHotkey(
    "project.picker",
    (e) => {
      if (isEditableTarget(e.target) && !wrapRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      setOpen((o) => !o);
    },
    { preventDefault: false },
  );

  // Reset state when opening; focus input.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Clamp highlight when filtered list shrinks.
  useEffect(() => {
    if (highlight >= flatItems.length) setHighlight(0);
  }, [flatItems, highlight]);

  // Scroll highlighted item into view.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeAndFocusTrigger();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = flatItems.length;
      if (n > 0) setHighlight((h) => (h + 1) % n);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = flatItems.length;
      if (n > 0) setHighlight((h) => (h - 1 + n) % n);
      return;
    }
    if (e.key === "Enter") {
      const target = flatItems[highlight];
      if (target) {
        e.preventDefault();
        select(target.id);
      }
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <HotkeyTooltip action="project.picker" label="Switch project">
        <Btn
          variant="gray-frame"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={currentActions ? "Switch project or manage project" : "Switch project"}
        >
          {current && <ProjectIcon project={current} size={14} />}
          <span>{label}</span>
          <Icon name="chevron-down" size={11} style={{ color: "var(--text-faint)" }} />
        </Btn>
      </HotkeyTooltip>
      {open && (
        <CardFrame
          role="dialog"
          aria-label={
            currentActions ? "Switch project or manage project" : "Switch project"
          }
          ref={dialogRef}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeAndFocusTrigger();
              return;
            }
            if (e.key === "Tab") {
              const focusables = dialogRef.current
                ? Array.from(
                    dialogRef.current.querySelectorAll<HTMLElement>(
                      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
                    ),
                  ).filter((node) => node.offsetParent !== null)
                : [];
              if (focusables.length === 0) return;
              const first = focusables[0]!;
              const last = focusables[focusables.length - 1]!;
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
          glow
          solid
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 360,
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search projects…"
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--text)",
                padding: "4px 6px",
              }}
            />
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", padding: 4 }}>
            {!projects ? (
              <div style={{ padding: 10, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-faint)" }}>
                Loading…
              </div>
            ) : flatItems.length === 0 ? (
              <div style={{ padding: 10, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-faint)" }}>
                No matches.
              </div>
            ) : (
              (() => {
                let idx = 0;
                return sections.map((section) => (
                  <div key={section.key}>
                    {section.label && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 8px 2px",
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: "var(--text-faint)",
                        }}
                      >
                        {section.color && (
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: section.color,
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span>{section.label}</span>
                      </div>
                    )}
                    {section.projects.map((p) => {
                      const i = idx++;
                      const active = p.id === projectId;
                      const highlighted = i === highlight;
                      return (
                        <button
                          key={p.id}
                          ref={(el) => {
                            itemRefs.current[i] = el;
                          }}
                          onClick={() => select(p.id)}
                          onMouseMove={() => setHighlight(i)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            background: highlighted
                              ? "var(--surface-2, var(--surface-1))"
                              : active
                                ? "var(--surface-1)"
                                : "transparent",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                            textAlign: "left",
                            fontFamily: "var(--mono)",
                            fontSize: 12,
                            color: "var(--text)",
                            outline: highlighted ? "1px solid var(--border)" : "none",
                          }}
                        >
                          <ProjectIcon project={p} size={18} />
                          <ProjectRunningDot running={isProjectActive(getProjectActivity(p, runningProjectIds))} size={7} />
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.name}
                          </span>
                          <ActivityCounts project={p} />
                          {active && <Icon name="check" size={12} style={{ color: "var(--text-faint)" }} />}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()
            )}
          </div>
          {currentActions && (
            <>
              <MenuSeparator />
              <div
                style={{
                  padding: "2px 12px 4px",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: "var(--text-faint)",
                }}
              >
                Project actions
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 2,
                  padding: "0 4px 6px",
                }}
              >
                {currentActions.hasRunningLaunch ? (
                  <>
                    <HotkeyTooltip action="project.runToggle">
                      <Btn
                        variant="ghost"
                        icon="x"
                        onClick={() => {
                          setOpen(false);
                          void currentActions.stopLaunch();
                        }}
                        disabled={currentActions.stopping}
                        style={{ justifyContent: "flex-start" }}
                      >
                        {currentActions.stopping ? "Stopping..." : "Stop launch"}
                      </Btn>
                    </HotkeyTooltip>
                    <MenuSeparator />
                  </>
                ) : null}
                <Btn
                  variant="ghost"
                  icon={currentActions.project.pinned ? "pin-fill" : "pin"}
                  onClick={() => {
                    setOpen(false);
                    void currentActions.toggleProjectPin();
                  }}
                  disabled={currentActions.pinning}
                  style={{ justifyContent: "flex-start" }}
                >
                  {currentActions.pinning
                    ? currentActions.project.pinned
                      ? "Unpinning..."
                      : "Pinning..."
                    : currentActions.project.pinned
                      ? "Unpin project"
                      : "Pin project"}
                </Btn>
                {currentActions.project.runtimeKind === "local" ? (
                  <Btn
                    variant="ghost"
                    icon="folder"
                    onClick={() => {
                      setOpen(false);
                      void getRuntime()?.openPath(currentActions.project.id, ".");
                    }}
                    style={{ justifyContent: "flex-start" }}
                    title={currentActions.project.path}
                  >
                    Reveal in Finder
                  </Btn>
                ) : null}
                {(currentActions.project.githubUrl || currentActions.project.repoUrl) && (
                  <Btn
                    variant="ghost"
                    icon="github"
                    onClick={() => {
                      setOpen(false);
                      window.open(
                        (currentActions.project.githubUrl || currentActions.project.repoUrl)!,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    style={{ justifyContent: "flex-start" }}
                  >
                    Open repository
                  </Btn>
                )}
                {currentActions.gitAvailable ? (
                  <HotkeyTooltip action="git.diff">
                    <Btn
                      variant="ghost"
                      icon="git-branch"
                      onClick={() => {
                        setOpen(false);
                        currentActions.openDiffView();
                      }}
                      style={{ justifyContent: "flex-start" }}
                      title={(() => {
                        const branch =
                          currentActions.gitStatus?.branch ??
                          currentActions.project.branch ??
                          DEFAULT_BRANCH;
                        if (
                          currentActions.gitStatus &&
                          currentActions.gitStatus.changedCount > 0
                        ) {
                          return `Branch ${branch} · ${currentActions.gitStatus.changedCount} changed file${
                            currentActions.gitStatus.changedCount === 1 ? "" : "s"
                          }`;
                        }
                        return `Branch ${branch}`;
                      })()}
                    >
                      <span style={{ flex: 1, textAlign: "left" }}>
                        Review Changes
                        {currentActions.gitStatus &&
                          currentActions.gitStatus.changedCount > 0 && (
                            <span style={{ color: "var(--text-dim)" }}>
                              {" · "}
                              {currentActions.gitStatus.changedCount} changed
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
                    setOpen(false);
                    currentActions.setShowLaunchConfig(true);
                  }}
                  style={{ justifyContent: "flex-start" }}
                >
                  Configure launch commands
                </Btn>
                <InstallSkillsMenuItem
                  projectId={currentActions.project.id}
                  onOpen={() => setOpen(false)}
                />
                <HotkeyTooltip action="project.edit">
                  <Btn
                    variant="ghost"
                    icon="settings"
                    onClick={() => {
                      setOpen(false);
                      currentActions.setShowEdit(true);
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
                    setOpen(false);
                    currentActions.setConfirmRemove(true);
                  }}
                  style={{ justifyContent: "flex-start" }}
                  title="Remove this project from Mission Control. The folder on disk is not touched."
                >
                  Remove project
                </Btn>
              </div>
            </>
          )}
        </CardFrame>
      )}
    </div>
  );
}
