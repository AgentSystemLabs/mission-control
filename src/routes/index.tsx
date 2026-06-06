import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { Icon } from "~/components/ui/Icon";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { groupProjects } from "~/lib/group-projects";
import { Section } from "~/components/ui/Section";
import { EmptyState } from "~/components/ui/EmptyState";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { ProjectCard } from "~/components/views/ProjectCard";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { ProjectsDashboardViewToggle } from "~/components/views/ProjectsDashboardViewToggle";
import { ProjectsTable } from "~/components/views/ProjectsTable";
import { GroupsDialog } from "~/components/views/GroupsDialog";
import { LaunchKitDialog } from "~/components/views/LaunchKitDialog";
import { useAddProject } from "~/lib/add-project-store";
import { useTerminals } from "~/lib/terminal-store";
import { api, type AppSettings } from "~/lib/api";
import {
  readCachedProjectsDashboardView,
  writeCachedProjectsDashboardView,
} from "~/lib/ui-preference-cache";
import { useServerEvents } from "~/lib/use-events";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  queryKeys,
  useEntitlements,
  useGroups,
  useLicense,
  useScopedProjects,
  useSettings,
} from "~/queries";
import type { ProjectWithCounts } from "~/shared/projects";
import { isAcademyTier } from "~/shared/license";
import { useHostedSession } from "~/components/views/AuthGate";
import type { Entitlements } from "~/shared/entitlements";
import { isWebDaytonaRuntime } from "~/lib/runtime";
import {
  DEFAULT_PROJECTS_DASHBOARD_VIEW,
  type ProjectsDashboardView,
} from "~/shared/ui-preferences";
import type { Group } from "~/db/schema";

export const Route = createFileRoute("/")({
  component: MissionControlPage,
});

function MissionControlPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectsQuery = useScopedProjects();
  const groupsQuery = useGroups();
  const projects = projectsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const { data: license } = useLicense();
  const { data: entitlements } = useEntitlements();
  const { session } = useHostedSession();
  const hostedWorkspaceCopy = isWebDaytonaRuntime();
  const launchKitAccess = useQuery({
    queryKey: ["launch-kit-access", license?.maskedKey ?? null, license?.status ?? null],
    queryFn: () => api.getLaunchKitAccess(),
    enabled: !!license?.hasKey && license.status === "active",
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [search, setSearch] = useState("");
  const [showGroups, setShowGroups] = useState(false);
  const [showLaunchKit, setShowLaunchKit] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectWithCounts | null>(null);
  const [removingProject, setRemovingProject] = useState<ProjectWithCounts | null>(null);
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const { data: settings } = useSettings();
  const settingsLoaded = settings !== undefined;
  const storedDashboardView = settings?.projectsDashboardView ?? null;
  const [dashboardView, setDashboardView] = useState<ProjectsDashboardView>(() =>
    readCachedProjectsDashboardView() ?? DEFAULT_PROJECTS_DASHBOARD_VIEW,
  );
  const terminals = useTerminals();
  const { setProject: setActiveUserTerminalProject, setHomeActive } = useUserTerminals();
  const { open: openAddProject } = useAddProject();

  const persistDashboardView = useCallback(
    (next: ProjectsDashboardView) => {
      setDashboardView(next);
      writeCachedProjectsDashboardView(next);
      queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
        current ? { ...current, projectsDashboardView: next } : current,
      );
      void api
        .updateSettings({ projectsDashboardView: next })
        .then((updated) => queryClient.setQueryData(queryKeys.settings, updated))
        .catch((error) => {
          console.error("[settings] failed to persist projects dashboard view:", error);
        });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!settingsLoaded) return;
    if (storedDashboardView) {
      setDashboardView(storedDashboardView);
      writeCachedProjectsDashboardView(storedDashboardView);
      return;
    }
    const cached = readCachedProjectsDashboardView();
    if (cached && cached !== DEFAULT_PROJECTS_DASHBOARD_VIEW) {
      persistDashboardView(cached);
    }
  }, [persistDashboardView, settingsLoaded, storedDashboardView]);

  // Dashboard has no project context — detach the user-terminal panel from
  // whichever project we were just viewing and activate the project-less "home"
  // terminal scope so the user can open terminals at ~ on the active scope
  // (local machine or remote VM). Deactivate home mode when leaving the dashboard.
  useEffect(() => {
    setActiveUserTerminalProject(null);
    setHomeActive(true);
    return () => setHomeActive(false);
  }, [setActiveUserTerminalProject, setHomeActive]);

  useHotkey("search.focus", () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  });

  useHotkey("agent.new", () => openAddProject());

  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const invalidateProject = useCallback(
    (id: string) => queryClient.invalidateQueries({ queryKey: queryKeys.project(id) }),
    [queryClient]
  );
  const invalidateGroups = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
    [queryClient]
  );
  const createGroupForSelection = useCallback(
    async (name: string) => {
      const { group } = await api.createGroup({ name });
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        current ? [...current, group] : [group],
      );
      await invalidateGroups();
      return group;
    },
    [invalidateGroups, queryClient],
  );

  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("project:") || e.type.startsWith("task:")) {
          void invalidateProjects();
        }
        if (e.type.startsWith("group:")) {
          void invalidateGroups();
        }
      },
      [invalidateProjects, invalidateGroups]
    )
  );

  const filter = (p: ProjectWithCounts) =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.path.toLowerCase().includes(search.toLowerCase());

  const filteredProjects = projects.filter(filter);
  const { pinned, byGroup, ungrouped } = groupProjects(filteredProjects, groups);
  const visibleProjectCount = filteredProjects.length;
  const dashboardSummary = search
    ? `${visibleProjectCount} of ${projects.length} ${projects.length === 1 ? "project" : "projects"} shown`
    : projects.length === 0
      ? hostedWorkspaceCopy
        ? "Create a hosted project to start remote sessions and agents."
        : "Add a project to start local sessions and agents."
      : [
          `${projects.length} ${projects.length === 1 ? "project" : "projects"}`,
          `${groups.length} ${groups.length === 1 ? "group" : "groups"}`,
          `${pinned.length} pinned`,
        ].join(", ");

  const gridCols = "repeat(auto-fill, minmax(300px, 1fr))";
  const showProjectContent =
    !projectsQuery.isLoading &&
    !groupsQuery.isLoading &&
    !projectsQuery.isError &&
    !groupsQuery.isError;

  const open = (id: string) => router.navigate({ to: "/projects/$id", params: { id } });
  const togglePin = async (id: string) => {
    await api.togglePin(id);
    await Promise.all([invalidateProjects(), invalidateProject(id)]);
  };
  const removeProject = async () => {
    if (!removingProject || removingProjectId) return;
    const projectId = removingProject.id;
    setRemovingProjectId(projectId);
    try {
      await terminals.closeForProject(projectId);
      await api.deleteProject(projectId);
      setRemovingProject(null);
      await Promise.all([invalidateProjects(), invalidateProject(projectId)]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove project");
    } finally {
      setRemovingProjectId(null);
    }
  };
  const canUseLaunchKit =
    (!!license && isAcademyTier(license)) || !!launchKitAccess.data?.hasAccess;
  const hostedRuntime = entitlements?.hosted.enabled ? entitlements.remoteRuntime : null;
  const renderProjectCard = (project: ProjectWithCounts) => (
    <ProjectCard
      key={project.id}
      project={project}
      onOpen={() => open(project.id)}
      onEdit={() => setEditingProject(project)}
      onRemove={() => setRemovingProject(project)}
      onTogglePin={togglePin}
    />
  );

  return (
    <>
      <CursorGlow />
      <div style={{ flex: 1, overflow: "auto", padding: 0 }} className="dot-grid-bg">
        <CardFrame
          className="mc-dashboard-frame"
          style={{
            width: "100%",
            minHeight: "100%",
            padding: 8,
          }}
        >
          <div
            className="mc-dashboard-header mc-dashboard-hero"
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              margin: "-8px -8px 28px",
              gap: 24,
              flexWrap: "wrap",
              padding: "28px 24px 24px",
              position: "relative",
              overflow: "hidden",
              isolation: "isolate",
            }}
          >
            <div className="mc-dashboard-hero-copy">
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
                Projects
              </h1>
              <div style={{ marginTop: 4, fontSize: 14, color: "var(--text-dim)" }}>
                {dashboardSummary}
              </div>
            </div>

            <div
              className="mc-dashboard-hero-actions"
              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
              <HotkeyTooltip action="search.focus" label="Focus search">
                <div
                  className="mc-input-frame"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    height: 36,
                    width: 220,
                  }}
                >
                  <Icon
                    name="search"
                    size={12}
                    style={{ color: "var(--text-faint)", marginRight: 6 }}
                  />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects…"
                    aria-label="Search projects"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: "transparent",
                      border: 0,
                      outline: 0,
                      color: "var(--text)",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                    }}
                  />
                </div>
              </HotkeyTooltip>

              <ProjectsDashboardViewToggle
                view={dashboardView}
                onChange={persistDashboardView}
              />

              <Btn variant="ghost" icon="group" onClick={() => setShowGroups(true)}>
                Groups
              </Btn>
              {canUseLaunchKit && (
                <Btn
                  variant="accent"
                  icon="sparkles"
                  onClick={() => setShowLaunchKit(true)}
                >
                  Launch Kit
                </Btn>
              )}
              <HotkeyTooltip action="project.add">
                <Btn variant="primary" icon="plus" onClick={openAddProject}>
                  Add project
                </Btn>
              </HotkeyTooltip>
            </div>
          </div>

          {hostedRuntime && (
            <HostedRuntimeNotice
              remoteRuntime={hostedRuntime}
              academyAccountUrl={session?.academyAccountUrl ?? null}
            />
          )}

          {(projectsQuery.isLoading || groupsQuery.isLoading) && (
            <EmptyState
              title="Loading projects"
              subtitle={
                hostedWorkspaceCopy
                  ? "Fetching your hosted projects, groups, and runtime state."
                  : "Fetching your local projects, groups, and runtime state."
              }
              icon="sparkles"
            />
          )}

          {(projectsQuery.isError || groupsQuery.isError) && (
            <EmptyState
              title="Could not load projects"
              subtitle={
                hostedWorkspaceCopy
                  ? "Mission Control could not load your hosted workspace. Check your connection, then retry."
                  : "Mission Control could not load your local workspace. Restart Mission Control, then retry."
              }
              icon="shield"
              action={
                <Btn
                  variant="primary"
                  icon="refresh"
                  onClick={() => {
                    void Promise.all([projectsQuery.refetch(), groupsQuery.refetch()]);
                  }}
                >
                  Retry
                </Btn>
              }
            />
          )}

          {!projectsQuery.isLoading && !groupsQuery.isLoading && !projectsQuery.isError && !groupsQuery.isError && dashboardView === "table" && filteredProjects.length > 0 && (
            <Section
              label="All projects"
              count={filteredProjects.length}
              icon="grid"
              divider={false}
              marginBottom={48}
              labelSize={13}
            >
              <ProjectsTable
                projects={filteredProjects}
                groups={groups}
                onOpen={open}
                onTogglePin={togglePin}
              />
            </Section>
          )}

          {showProjectContent && dashboardView === "cards" && pinned.length > 0 && (
            <Section
              label="Pinned"
              count={pinned.length}
              icon="pin-fill"
              divider={false}
              marginBottom={48}
              labelSize={13}
            >
              <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
                {pinned.map(renderProjectCard)}
              </div>
            </Section>
          )}

          {showProjectContent && dashboardView === "cards" && byGroup.map(({ group, projects: gp }) => (
            <Section
              key={group.id}
              label={group.name}
              count={gp.length}
              dot={group.color}
              divider={false}
              marginBottom={48}
              labelSize={13}
            >
              <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
                {gp.map(renderProjectCard)}
              </div>
            </Section>
          ))}

          {showProjectContent && dashboardView === "cards" && ungrouped.length > 0 && (
            <Section
              label="Ungrouped"
              count={ungrouped.length}
              divider={false}
              marginBottom={48}
              labelSize={13}
            >
              <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
                {ungrouped.map(renderProjectCard)}
              </div>
            </Section>
          )}

          {!projectsQuery.isLoading && !groupsQuery.isLoading && !projectsQuery.isError && !groupsQuery.isError && filteredProjects.length === 0 && (
            <EmptyState
              title={search ? "No matches" : "No projects yet"}
              subtitle={
                search
                  ? "Try a different search."
                  : hostedRuntime
                    ? "Create your first hosted project. Terminals and agents run in isolated cloud workspaces."
                    : "Add your first project to start running sessions."
              }
              action={
                !search && (
                  <HotkeyTooltip action="project.add">
                    <Btn variant="primary" icon="plus" onClick={openAddProject}>
                      Add project
                    </Btn>
                  </HotkeyTooltip>
                )
              }
            />
          )}
        </CardFrame>
      </div>

      <GroupsDialog
        open={showGroups}
        groups={groups}
        projects={projects}
        onClose={() => setShowGroups(false)}
        onAdd={async (name) => {
          await createGroupForSelection(name);
        }}
        onRemove={async (id) => {
          await api.deleteGroup(id);
          await Promise.all([invalidateGroups(), invalidateProjects()]);
        }}
        onRename={async (id, name) => {
          await api.updateGroup(id, { name });
          await invalidateGroups();
        }}
        onProjectGroupChange={async (projectId, groupId) => {
          await api.updateProject(projectId, { groupId });
          await Promise.all([invalidateProjects(), invalidateProject(projectId)]);
        }}
      />
      <LaunchKitDialog
        open={showLaunchKit}
        onClose={() => setShowLaunchKit(false)}
        onCreated={() => {
          setShowLaunchKit(false);
          void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
        }}
      />
      {editingProject && (
        <ProjectDialog
          open
          project={editingProject}
          groups={groups}
          onCreateGroup={createGroupForSelection}
          onClose={() => setEditingProject(null)}
          onSave={async (data) => {
            const projectId = editingProject.id;
            await api.updateProject(projectId, data);
            setEditingProject(null);
            await Promise.all([invalidateProjects(), invalidateProject(projectId)]);
          }}
        />
      )}
      <ConfirmDialog
        open={removingProject !== null}
        onClose={() => {
          if (!removingProjectId) setRemovingProject(null);
        }}
        onConfirm={removeProject}
        title="Remove project"
        confirmLabel="Remove"
        icon="trash"
        loading={removingProjectId !== null}
        width={460}
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Remove &ldquo;{removingProject?.name}&rdquo; from MissionControl?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          This only unlinks the project — the files at {removingProject?.path} are not touched.
        </div>
      </ConfirmDialog>
    </>
  );
}

function HostedRuntimeNotice({
  remoteRuntime,
  academyAccountUrl,
}: {
  remoteRuntime: Entitlements["remoteRuntime"];
  academyAccountUrl: string | null;
}) {
  const router = useRouter();
  const allowed = remoteRuntime.allowed;
  if (allowed) {
    return null;
  }

  const message = remoteRuntime.reason === "account-blocked"
      ? "Hosted runtime is blocked for this account. Contact support if this looks wrong."
      : remoteRuntime.reason === "auth-required"
        ? "Sign in through Academy to use hosted runtime."
        : "Hosted runtime needs an active Academy plan before remote compute can start. If you hit a compute limit, Mission Control will pause new remote sessions until the window resets or your Academy plan changes.";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        margin: "0 12px 28px",
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface-1)",
        color: "var(--text-dim)",
        fontSize: 12,
        fontFamily: "var(--mono)",
      }}
    >
      <span>{message}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => router.navigate({ to: "/plans" })}
        >
          Compare plans
        </Btn>
        {!allowed && academyAccountUrl && (
          <Btn
            variant="ghost"
            size="sm"
            icon="external-link"
            onClick={() => window.open(academyAccountUrl, "_blank", "noopener,noreferrer")}
          >
            Academy billing
          </Btn>
        )}
      </div>
    </div>
  );
}
