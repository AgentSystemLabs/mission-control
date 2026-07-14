import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { RemoveProjectConfirmDialog } from "~/components/views/RemoveProjectConfirmDialog";
import { Icon } from "~/components/ui/Icon";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { useDebouncedCallback } from "~/lib/use-debounced-callback";
import { groupProjects } from "~/lib/group-projects";
import { Section } from "~/components/ui/Section";
import { EmptyState } from "~/components/ui/EmptyState";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { ProjectCard } from "~/components/views/ProjectCard";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { ProjectsDashboardViewToggle } from "~/components/views/ProjectsDashboardViewToggle";
import { ProjectsTable } from "~/components/views/ProjectsTable";
import { GroupFilterChips } from "~/components/views/GroupFilterChips";
import {
  ACTIVE_GROUP_ALL,
  ACTIVE_GROUP_UNGROUPED,
  activeGroupLabel,
  useGroupScopedProjects,
} from "~/lib/active-group";
import { useGroupsDialog } from "~/lib/groups-dialog-store";
import { useAddProject } from "~/lib/add-project-store";
import { useTerminalActions } from "~/lib/terminal-store";
import { api, type AppSettings } from "~/lib/api";
import {
  readCachedProjectsDashboardView,
  writeCachedProjectsDashboardView,
} from "~/lib/ui-preference-cache";
import { useServerEvents } from "~/lib/use-events";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  queryKeys,
  useGroups,
  useSettings,
} from "~/queries";
import type { ProjectWithCounts } from "~/shared/projects";
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
  const projectsQuery = useGroupScopedProjects();
  const groupsQuery = useGroups();
  const projects = projectsQuery.data ?? [];
  // Sandbox-scoped but group-UNscoped — chip counts must ignore the group filter.
  const allScopedProjects = projectsQuery.unscopedData ?? [];
  const { activeGroup, setActiveGroup } = projectsQuery;
  const groups = groupsQuery.data ?? [];
  const groupsDialog = useGroupsDialog();
  const [search, setSearch] = useState("");
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
  const terminals = useTerminalActions();
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

  // A running agent emits many task:* events per second; each used to refetch
  // the (heavy) projects list. Coalesce those SSE-driven refreshes into one
  // trailing refetch per 150ms burst. Explicit user actions below still
  // invalidate immediately.
  // maxWait bounds staleness under a sustained event storm: without it a
  // continuous <150ms stream would defer the refetch indefinitely.
  const invalidateProjectsDebounced = useDebouncedCallback(() => {
    void invalidateProjects();
  }, 150, 400);

  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("project:") || e.type.startsWith("task:")) {
          invalidateProjectsDebounced();
        }
        if (e.type.startsWith("group:")) {
          void invalidateGroups();
        }
      },
      [invalidateProjectsDebounced, invalidateGroups]
    )
  );

  const filter = (p: ProjectWithCounts) =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.path.toLowerCase().includes(search.toLowerCase());

  const filteredProjects = projects.filter(filter);
  const { pinned, byGroup, ungrouped } = groupProjects(filteredProjects, groups);
  const visibleProjectCount = filteredProjects.length;
  const groupScoped = activeGroup !== ACTIVE_GROUP_ALL;
  const activeLabel = activeGroupLabel(activeGroup, groups);
  const activeGroupColor =
    groupScoped && activeGroup !== ACTIVE_GROUP_UNGROUPED
      ? groups.find((g) => g.id === activeGroup)?.color
      : undefined;
  // Group-scoped cards view renders a single section, pinned projects first.
  const scopedOrdered = groupScoped
    ? [...filteredProjects.filter((p) => p.pinned), ...filteredProjects.filter((p) => !p.pinned)]
    : filteredProjects;
  const dashboardSummary = search
    ? `${visibleProjectCount} of ${projects.length} ${projects.length === 1 ? "project" : "projects"} shown`
    : groupScoped
      ? `${projects.length} ${projects.length === 1 ? "project" : "projects"} in ${activeLabel}, ${allScopedProjects.length} total`
      : projects.length === 0
        ? "Add a project to start local sessions and agents."
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

              <Btn
                variant="ghost"
                icon="group"
                onClick={groupsDialog.open}
                style={{
                  height: 36,
                  ["--mc-btn-height" as string]: "36px",
                }}
              >
                Groups
              </Btn>
              <HotkeyTooltip action="project.add">
                <Btn
                  variant="primary"
                  icon="plus"
                  onClick={openAddProject}
                  style={{
                    height: 36,
                    ["--mc-btn-height" as string]: "36px",
                  }}
                >
                  Add project
                </Btn>
              </HotkeyTooltip>
            </div>
          </div>

          <GroupFilterChips
            groups={groups}
            projects={allScopedProjects}
            activeGroup={activeGroup}
            onChange={setActiveGroup}
          />

          {(projectsQuery.isLoading || groupsQuery.isLoading) && (
            <EmptyState
              title="Loading projects"
              subtitle="Fetching your local projects, groups, and runtime state."
              icon="sparkles"
            />
          )}

          {(projectsQuery.isError || groupsQuery.isError) && (
            <EmptyState
              title="Could not load projects"
              subtitle="Mission Control could not load your local workspace. Restart Mission Control, then retry."
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

          {showProjectContent && dashboardView === "table" && filteredProjects.length > 0 && (
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

          {showProjectContent && dashboardView === "cards" && groupScoped && scopedOrdered.length > 0 && (
            <Section
              label={activeLabel}
              count={scopedOrdered.length}
              dot={activeGroupColor}
              divider={false}
              marginBottom={48}
              labelSize={13}
            >
              <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
                {scopedOrdered.map(renderProjectCard)}
              </div>
            </Section>
          )}

          {showProjectContent && dashboardView === "cards" && !groupScoped && pinned.length > 0 && (
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

          {showProjectContent && dashboardView === "cards" && !groupScoped && byGroup.map(({ group, projects: gp }) => (
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

          {showProjectContent && dashboardView === "cards" && !groupScoped && ungrouped.length > 0 && (
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

          {showProjectContent && filteredProjects.length === 0 && (
            <EmptyState
              title={
                search
                  ? "No matches"
                  : groupScoped
                    ? `No projects in ${activeLabel}`
                    : "No projects yet"
              }
              subtitle={
                search
                  ? "Try a different search."
                  : groupScoped
                    ? "Move a project into this group, or add a new one — it will land here."
                    : "Add your first project to start running sessions."
              }
              action={
                !search && (
                  <HotkeyTooltip action="project.add">
                    <Btn variant="primary" icon="plus" onClick={openAddProject}>
                      {groupScoped && activeGroup !== ACTIVE_GROUP_UNGROUPED
                        ? `Add project to ${activeLabel}`
                        : "Add project"}
                    </Btn>
                  </HotkeyTooltip>
                )
              }
            />
          )}
        </CardFrame>
      </div>

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
      <RemoveProjectConfirmDialog
        open={removingProject !== null}
        onClose={() => {
          if (!removingProjectId) setRemovingProject(null);
        }}
        onConfirm={removeProject}
        loading={removingProjectId !== null}
        projectName={removingProject?.name}
        projectPath={removingProject?.path}
      />
    </>
  );
}
