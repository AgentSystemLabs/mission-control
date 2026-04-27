import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { EmptyState } from "~/components/ui/EmptyState";
import { TaskColumn } from "~/components/views/TaskColumn";
import { NewAgentDialog } from "~/components/views/NewAgentDialog";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { AgentGlyph } from "~/components/ui/AgentGlyph";
import { Kbd, hotkeyLabel } from "~/components/ui/Kbd";
import { useHotkey } from "~/lib/use-hotkey";
import { useWheelSwipe } from "~/lib/use-wheel-swipe";
import { api } from "~/lib/api";
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
  const [apiToken, setApiToken] = useState<string | null>(null);

  const newAgentHotkey = hotkeyLabel("mod+n");
  const editProjectHotkey = hotkeyLabel("mod+e");

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

  useHotkey(
    "mod+n",
    () => {
      if (showNewAgent || showEdit) return;
      setShowNewAgent(true);
    },
    { ignoreEditable: true },
  );

  useHotkey("mod+e", () => {
    if (showNewAgent) return;
    setShowEdit((v) => !v);
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

  const selectedSet = new Set(terminals.open.map((t) => t.taskId));

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

  const remove = async () => {
    if (!confirm(`Remove "${project.name}" from MissionControl?\n\nThis only unlinks the project — the files at ${project.path} are not touched.`)) {
      return;
    }
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
    <div style={{ flex: 1, overflow: "auto", padding: "24px 32px 80px" }} className="dot-grid-bg">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 24,
            paddingBottom: 20,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <ProjectIcon project={project} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em" }}>
                {project.name}
              </h1>
              {project.pinned && (
                <Icon name="pin-fill" size={13} style={{ color: "var(--accent)" }} />
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span>{project.path}</span>
              <span>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="git-branch" size={11} /> {project.branch}
              </span>
            </div>
          </div>
          <Btn variant="ghost" icon="settings" onClick={() => setShowEdit(true)}>
            Edit
            <Kbd>{editProjectHotkey}</Kbd>
          </Btn>
          <Btn variant="primary" icon="plus" onClick={() => setShowNewAgent(true)}>
            New agent
            <Kbd variant="onPrimary">{newAgentHotkey}</Kbd>
          </Btn>
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
                selectedSet={selectedSet}
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
                  <Btn variant="primary" icon="plus" onClick={() => setShowNewAgent(true)}>
                    New agent
                    <Kbd variant="onPrimary">{newAgentHotkey}</Kbd>
                  </Btn>
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
    </div>
  );
}
