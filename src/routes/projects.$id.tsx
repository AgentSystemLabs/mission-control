import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { EmptyState } from "~/components/ui/EmptyState";
import { TaskColumn } from "~/components/views/TaskColumn";
import { NewAgentDialog } from "~/components/views/NewAgentDialog";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { LaunchButton } from "~/components/views/LaunchButton";
import { NewAgentButton } from "~/components/views/NewAgentButton";
import { AgentGlyph } from "~/components/ui/AgentGlyph";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { Kbd } from "~/components/ui/Kbd";
import { useFormattedBinding } from "~/lib/keybindings/store";
import { Modal } from "~/components/ui/Modal";
import { useHotkey } from "~/lib/use-hotkey";
import { useWheelSwipe } from "~/lib/use-wheel-swipe";
import { api } from "~/lib/api";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { getElectron } from "~/lib/electron";
import { useServerEvents } from "~/lib/use-events";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { TASK_STATUSES } from "~/db/schema";
import type { Group, Task, TaskStatus } from "~/db/schema";
import { STATUS_META } from "~/lib/design-meta";
import type { ProjectWithCounts } from "~/server/services/projects";

export const Route = createFileRoute("/projects/$id")({
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const [project, setProject] = useState<ProjectWithCounts | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [apiToken, setApiToken] = useState<string | null>(null);

  const editProjectHotkey = useFormattedBinding("project.edit");

  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerNarrow, setHeaderNarrow] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setHeaderNarrow(entry.contentRect.width < 720);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const terminals = useTerminals();
  const { setProject: setActiveUserTerminalProject } = useUserTerminals();

  useEffect(() => {
    if (project) setActiveUserTerminalProject(project);
  }, [project, setActiveUserTerminalProject]);

  const refresh = useCallback(async () => {
    try {
      const [pr, ts, gs, st] = await Promise.all([
        api.getProject(id),
        api.listTasks(id),
        api.listGroups(),
        api.getSettings(),
      ]);
      setProject(pr.project);
      setTasks(ts.tasks);
      setGroups(gs.groups);
      setApiToken(st.apiToken);
    } catch {
      router.navigate({ to: "/" });
    }
  }, [id, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      sessionStorage.setItem("lastProjectId", id);
    } catch {}
  }, [id]);

  const goBack = useCallback(() => router.navigate({ to: "/" }), [router]);

  useEffect(() => {
    const off = getElectron()?.onSwipe((dir) => {
      if (dir === "left") goBack();
    });
    return () => {
      off?.();
    };
  }, [goBack]);

  useWheelSwipe("left", goBack);

  const startWithSaved = useCallback(async () => {
    if (!project || !apiToken) return;
    if (!(project.rememberAgentSettings && project.savedAgent)) return;
    const created = await api.createTaskInternal(
      project.id,
      { title: TITLE_WAITING, agent: project.savedAgent, branch: project.branch || "main" },
      apiToken
    );
    await refresh();
    const startCommandOverride =
      project.savedAgent === "claude-code" && project.savedSkipPermissions
        ? "claude --dangerously-skip-permissions"
        : undefined;
    terminals.toggle(project, created.task, { startCommandOverride });
  }, [project, apiToken, refresh, terminals]);

  const onNewAgentPrimary = useCallback(() => {
    if (showNewAgent || showEdit) return;
    if (project?.rememberAgentSettings && project.savedAgent) {
      void startWithSaved();
      return;
    }
    setShowNewAgent(true);
  }, [project, showNewAgent, showEdit, startWithSaved]);

  useHotkey("agent.new", onNewAgentPrimary, { ignoreEditable: true });

  useHotkey("project.edit", () => {
    if (showNewAgent) return;
    setShowEdit((v) => !v);
  });

  const closePanelEnabled =
    !showNewAgent && !showEdit && !confirmRemove && terminals.active !== null;

  // Capture phase so xterm.js (focused terminal) can't swallow the key first.
  useHotkey("terminal.close", () => terminals.deselect(), {
    enabled: closePanelEnabled,
    capture: true,
  });

  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("task:") || e.type.startsWith("project:")) void refresh();
      },
      [refresh]
    )
  );

  if (!project) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          flex: 1,
          padding: 32,
          color: "var(--text-dim)",
          fontFamily: "var(--mono)",
          fontSize: 12,
        }}
      >
        Loading…
      </div>
    );
  }

  const visibleTasks = tasks.filter((t) => (filter === "archived" ? t.archived : !t.archived));
  const tasksByStatus = TASK_STATUSES.reduce(
    (acc, s) => {
      acc[s] = [];
      return acc;
    },
    {} as Record<TaskStatus, Task[]>
  );
  for (const t of visibleTasks) tasksByStatus[t.status].push(t);

  const activeId =
    terminals.active && terminals.active.project.id === project.id
      ? terminals.active.taskId
      : null;

  const toggleTerminal = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    terminals.toggle(project, task);
  };

  const archive = async (taskId: string) => {
    await api.archiveTask(taskId);
    await terminals.close(taskId);
    await refresh();
  };

  const deleteTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    await terminals.close(taskId);
    await api.deleteTask(taskId);
    await refresh();
  };

  const remove = () => {
    setConfirmRemove(true);
  };

  const confirmRemoveProject = async () => {
    if (!project) return;
    setConfirmRemove(false);
    await terminals.closeForProject(project.id);
    await api.deleteProject(project.id);
    router.navigate({ to: "/" });
  };

  const startAgent = async (data: {
    agent: any;
    title: string;
    branch: string;
    dangerouslySkipPermissions: boolean;
  }) => {
    if (!apiToken) return;
    const created = await api.createTaskInternal(
      project.id,
      { title: data.title, agent: data.agent, branch: data.branch },
      apiToken
    );
    setShowNewAgent(false);
    await refresh();
    const startCommandOverride =
      data.agent === "claude-code" && data.dangerouslySkipPermissions
        ? "claude --dangerously-skip-permissions"
        : undefined;
    terminals.toggle(project, created.task, { startCommandOverride });
  };

  return (
    <>
      <CursorGlow />
      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px 80px" }} className="dot-grid-bg">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          ref={headerRef}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 24,
            paddingBottom: 20,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <ProjectIcon project={project} size={52} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              overflow: "hidden",
            }}
          >
            <h1
              style={{
                margin: 0,
                fontSize: 22,
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
            {project.pinned && (
              <Icon
                name="pin-fill"
                size={13}
                style={{ color: "var(--accent)", flexShrink: 0 }}
              />
            )}
            <Btn
              variant="ghost"
              size="sm"
              icon="folder"
              onClick={() => window.electronAPI?.openPath(project.path)}
              title={`Reveal in Finder — ${project.path}`}
              aria-label="Reveal project folder in Finder"
              style={{ flexShrink: 0 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <LaunchButton
              project={project}
              onProjectUpdated={refresh}
              compact={headerNarrow}
            />
            {project.githubUrl && (
              <Btn
                variant="ghost"
                icon="github"
                onClick={() => window.open(project.githubUrl!, "_blank", "noreferrer")}
                title="Open GitHub repo"
                aria-label="Open GitHub repo"
                style={{ width: 30, padding: 0 }}
              />
            )}
            <Btn
              variant="ghost"
              icon="settings"
              onClick={() => setShowEdit(true)}
              title={`Edit project (${editProjectHotkey})`}
              aria-label={`Edit project (${editProjectHotkey})`}
              style={{ width: 30, padding: 0, marginRight: 4 }}
            />
            <NewAgentButton
              project={project}
              onPrimary={onNewAgentPrimary}
              onConfigure={() => setShowNewAgent(true)}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 2,
            marginBottom: 20,
            padding: 3,
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            width: "fit-content",
          }}
        >
          {[
            { id: "active" as const, label: "Active", count: tasks.filter((t) => !t.archived).length },
            { id: "archived" as const, label: "Archived", count: tasks.filter((t) => t.archived).length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              aria-pressed={filter === tab.id}
              aria-label={`${tab.label} tasks (${tab.count})`}
              style={{
                background: filter === tab.id ? "var(--surface-3)" : "transparent",
                border: 0,
                cursor: "pointer",
                padding: "6px 14px",
                borderRadius: 5,
                color: filter === tab.id ? "var(--text)" : "var(--text-dim)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {tab.label}
              <span style={{ color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {filter === "active" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {TASK_STATUSES.map((status) => (
              <TaskColumn
                key={status}
                title={STATUS_META[status].label}
                color={STATUS_META[status].color}
                tasks={tasksByStatus[status]}
                activeId={activeId}
                onToggle={toggleTerminal}
                onArchive={archive}
                onDelete={deleteTask}
              />
            ))}
            {visibleTasks.length === 0 && (
              <EmptyState
                title="No active tasks"
                subtitle="Start a new agent to begin working on this project."
                action={
                  <NewAgentButton
                    project={project}
                    onPrimary={onNewAgentPrimary}
                    onConfigure={() => setShowNewAgent(true)}
                  />
                }
              />
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleTasks.length === 0 ? (
              <EmptyState
                title="Nothing archived"
                subtitle="Archived tasks will appear here."
                icon="archive"
              />
            ) : (
              visibleTasks.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  <AgentGlyph agent={t.agent} size={12} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--text)" }}>{t.title}</div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: "var(--text-faint)",
                        marginTop: 2,
                      }}
                    >
                      {t.branch} · +{t.lines} lines · archived
                    </div>
                  </div>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.restoreTask(t.id);
                      await refresh();
                    }}
                  >
                    Restore
                  </Btn>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <NewAgentDialog
        open={showNewAgent}
        project={project}
        onClose={() => setShowNewAgent(false)}
        onStart={startAgent}
        onPersistRemember={async (patch) => {
          await api.updateProject(project.id, patch);
          await refresh();
        }}
      />

      <ProjectDialog
        open={showEdit}
        project={project}
        groups={groups}
        onClose={() => setShowEdit(false)}
        onSave={async (data) => {
          await api.updateProject(project.id, data);
          setShowEdit(false);
          await refresh();
        }}
        onDelete={remove}
      />

      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove project"
        width={460}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel <Kbd variant="inline">Esc</Kbd>
            </Btn>
            <Btn variant="danger" icon="trash" onClick={confirmRemoveProject}>
              Remove
            </Btn>
          </>
        }
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Remove &ldquo;{project.name}&rdquo; from MissionControl?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          This only unlinks the project — the files at {project.path} are not touched.
        </div>
      </Modal>
      </div>
    </>
  );
}
