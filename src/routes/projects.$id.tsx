import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { EmptyState } from "~/components/ui/EmptyState";
import { TaskColumn } from "~/components/views/TaskColumn";
import { NewAgentDialog } from "~/components/views/NewAgentDialog";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { FileFinderDialog } from "~/components/views/FileFinderDialog";
import { FileEditorDialog } from "~/components/views/FileEditorDialog";
import { LaunchButton } from "~/components/views/LaunchButton";
import { NewAgentButton } from "~/components/views/NewAgentButton";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { Kbd, KbdAction } from "~/components/ui/Kbd";
import { useFormattedBinding } from "~/lib/keybindings/store";
import { Modal } from "~/components/ui/Modal";
import { useHotkey } from "~/lib/use-hotkey";
import { api } from "~/lib/api";
import { newSessionId } from "~/lib/claude-command";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { useServerEvents } from "~/lib/use-events";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  groupsQueryOptions,
  projectQueryOptions,
  queryKeys,
  settingsQueryOptions,
  tasksQueryOptions,
  useGroups,
  useProject,
  useSettings,
  useTasks,
} from "~/queries";
import { gitStatusQueryOptions, useGitStatus } from "~/queries/git";
import { GitDiffView } from "~/components/views/GitDiffView";
import { TASK_STATUSES } from "~/db/schema";
import type { Task, TaskStatus } from "~/db/schema";
import { STATUS_META } from "~/lib/design-meta";

const STATUS_DISPLAY_ORDER: readonly TaskStatus[] = [
  "needs-input",
  "ready",
  "running",
  "finished",
  "terminated",
  "disconnected",
];

const projectSearchSchema = z.object({
  view: z.enum(["diff"]).optional(),
});

export const Route = createFileRoute("/projects/$id")({
  validateSearch: projectSearchSchema,
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectQueryOptions(params.id)),
      context.queryClient.ensureQueryData(tasksQueryOptions(params.id)),
      context.queryClient.ensureQueryData(groupsQueryOptions()),
      context.queryClient.ensureQueryData(settingsQueryOptions()),
      context.queryClient
        .ensureQueryData(gitStatusQueryOptions(params.id))
        .catch(() => null),
    ]),
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: project, error: projectError } = useProject(id);
  const { data: tasks = [] } = useTasks(id);
  const { data: groups = [] } = useGroups();
  const { data: settings } = useSettings();
  const { data: gitStatus } = useGitStatus(id);
  const showDiffView = search.view === "diff";

  const openDiffView = useCallback(() => {
    router.navigate({
      to: "/projects/$id",
      params: { id },
      search: { view: "diff" },
    });
  }, [router, id]);

  const closeDiffView = useCallback(() => {
    router.navigate({
      to: "/projects/$id",
      params: { id },
      search: {},
    });
  }, [router, id]);
  const apiToken = settings?.apiToken ?? null;
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [fileFinderOpen, setFileFinderOpen] = useState(false);
  const [openFileRel, setOpenFileRel] = useState<string | null>(null);

  useEffect(() => {
    if (projectError) router.navigate({ to: "/" });
  }, [projectError, router]);

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

  useEffect(() => {
    for (const task of tasks) terminals.syncTask(task);
  }, [tasks, terminals.syncTask]);

  const invalidateProject = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.project(id) }),
    [queryClient, id]
  );
  const invalidateTasks = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks(id) }),
    [queryClient, id]
  );
  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const refresh = useCallback(async () => {
    await Promise.all([invalidateProject(), invalidateTasks(), invalidateProjects()]);
  }, [invalidateProject, invalidateTasks, invalidateProjects]);

  const startWithSaved = useCallback(async () => {
    if (!project || !apiToken) return;
    if (!(project.rememberAgentSettings && project.savedAgent)) return;
    const isClaude = project.savedAgent === "claude-code";
    const created = await api.createTaskInternal(
      project.id,
      {
        title: TITLE_WAITING,
        agent: project.savedAgent,
        branch: project.branch || "main",
        claudeSessionId: isClaude ? newSessionId() : undefined,
        claudeSkipPermissions: isClaude ? !!project.savedSkipPermissions : undefined,
      },
      apiToken
    );
    await refresh();
    terminals.toggle(project, created.task);
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

  useHotkey(
    "file.finder",
    () => {
      if (openFileRel || showNewAgent || showEdit || confirmRemove) return;
      setFileFinderOpen((v) => !v);
    },
    { ignoreEditable: true },
  );

  useHotkey(
    "git.diff",
    () => {
      if (
        openFileRel ||
        showNewAgent ||
        showEdit ||
        confirmRemove ||
        fileFinderOpen
      ) return;
      if (showDiffView) closeDiffView();
      else openDiffView();
    },
    { ignoreEditable: true },
  );

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
        if (e.type.startsWith("task:")) {
          void invalidateTasks();
          void invalidateProject();
        } else if (e.type.startsWith("project:")) {
          void invalidateProject();
          void invalidateProjects();
        }
      },
      [invalidateTasks, invalidateProject, invalidateProjects]
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

  const visibleTasks = tasks.filter((t) => !t.archived);
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

  const clearAll = async () => {
    setConfirmClearAll(false);
    await terminals.closeForProject(project.id);
    await Promise.all(visibleTasks.map((t) => api.deleteTask(t.id).catch(() => undefined)));
    await refresh();
  };

  const startAgent = async (data: {
    agent: any;
    title: string;
    branch: string;
    dangerouslySkipPermissions: boolean;
  }) => {
    if (!apiToken) return;
    const isClaude = data.agent === "claude-code";
    const created = await api.createTaskInternal(
      project.id,
      {
        title: data.title,
        agent: data.agent,
        branch: data.branch,
        claudeSessionId: isClaude ? newSessionId() : undefined,
        claudeSkipPermissions: isClaude ? data.dangerouslySkipPermissions : undefined,
      },
      apiToken
    );
    setShowNewAgent(false);
    await refresh();
    terminals.toggle(project, created.task);
  };

  if (showDiffView) {
    return (
      <>
        <CursorGlow />
        <GitDiffView
          projectId={project.id}
          projectPath={project.path}
          onBack={closeDiffView}
        />
      </>
    );
  }

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
            {gitStatus && gitStatus.changedCount > 0 && (
              <Btn
                variant="ghost"
                icon="git-branch"
                onClick={openDiffView}
                title={`${gitStatus.changedCount} changed file${gitStatus.changedCount === 1 ? "" : "s"} on ${gitStatus.branch} — review diffs`}
                aria-label={`Review ${gitStatus.changedCount} changed file${gitStatus.changedCount === 1 ? "" : "s"}`}
              >
                {gitStatus.changedCount} changed
                <KbdAction action="git.diff" />
              </Btn>
            )}
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

        {visibleTasks.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: 20,
            }}
          >
            <Btn
              variant="ghost"
              size="sm"
              icon="trash"
              onClick={() => setConfirmClearAll(true)}
              title="Stop and remove all agents and terminals for this project"
            >
              Clear all
            </Btn>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {STATUS_DISPLAY_ORDER.map((status) => (
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

      <FileFinderDialog
        open={fileFinderOpen}
        projectRoot={project.path}
        onClose={() => setFileFinderOpen(false)}
        onPick={(rel) => setOpenFileRel(rel)}
      />

      <FileEditorDialog
        projectRoot={project.path}
        relPath={openFileRel}
        onClose={() => setOpenFileRel(null)}
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

      <Modal
        open={confirmClearAll}
        onClose={() => setConfirmClearAll(false)}
        title="Clear all agents"
        width={460}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirmClearAll(false)}>
              Cancel <Kbd variant="inline">Esc</Kbd>
            </Btn>
            <Btn variant="danger" icon="trash" onClick={clearAll}>
              Clear all
            </Btn>
          </>
        }
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Stop and remove every agent and terminal in &ldquo;{project.name}&rdquo;?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {visibleTasks.length} agent{visibleTasks.length === 1 ? "" : "s"} will be deleted and their terminals killed. This only affects this project.
        </div>
      </Modal>
      </div>
    </>
  );
}
