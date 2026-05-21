import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { KbdAction } from "~/components/ui/Kbd";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { groupProjects } from "~/lib/group-projects";
import { Section } from "~/components/ui/Section";
import { EmptyState } from "~/components/ui/EmptyState";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { ProjectCard } from "~/components/views/ProjectCard";
import { GroupsDialog } from "~/components/views/GroupsDialog";
import { LaunchKitDialog } from "~/components/views/LaunchKitDialog";
import { useAddProject } from "~/lib/add-project-store";
import { api } from "~/lib/api";
import { useServerEvents } from "~/lib/use-events";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  queryKeys,
  useEntitlements,
  useGroups,
  useLicense,
  useProjects,
} from "~/queries";
import type { ProjectWithCounts } from "~/shared/projects";
import { isAcademyTier } from "~/shared/license";
import { useHostedSession } from "~/components/views/AuthGate";
import type { Entitlements } from "~/shared/entitlements";
import { isWebDaytonaRuntime } from "~/lib/runtime";

export const Route = createFileRoute("/")({
  component: MissionControlPage,
});

function MissionControlPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectsQuery = useProjects();
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
  const searchRef = useRef<HTMLInputElement | null>(null);
  const { setProject: setActiveUserTerminalProject } = useUserTerminals();
  const { open: openAddProject } = useAddProject();

  // Dashboard has no project context — detach the user-terminal panel from
  // whichever project we were just viewing.
  useEffect(() => {
    setActiveUserTerminalProject(null);
  }, [setActiveUserTerminalProject]);

  useHotkey("search.focus", () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  });

  useHotkey("agent.new", () => openAddProject());

  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const invalidateGroups = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
    [queryClient]
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

  const open = (id: string) => router.navigate({ to: "/projects/$id", params: { id } });
  const togglePin = async (id: string) => {
    await api.togglePin(id);
    await invalidateProjects();
  };
  const canUseLaunchKit =
    (!!license && isAcademyTier(license)) || !!launchKitAccess.data?.hasAccess;
  const hostedRuntime = entitlements?.hosted.enabled ? entitlements.remoteRuntime : null;

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
                    background: "transparent",
                    border: 0,
                    outline: 0,
                    color: "var(--text)",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                  }}
                />
                <KbdAction action="search.focus" />
              </div>

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
              <HotkeyTooltip action="agent.new">
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

          {!projectsQuery.isLoading && !groupsQuery.isLoading && !projectsQuery.isError && !groupsQuery.isError && pinned.length > 0 && (
            <Section
              label="Pinned"
              count={pinned.length}
              icon="pin-fill"
              divider={false}
              marginBottom={48}
              labelSize={13}
            >
              <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
                {pinned.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onOpen={() => open(p.id)}
                    onTogglePin={togglePin}
                  />
                ))}
              </div>
            </Section>
          )}

          {!projectsQuery.isLoading && !groupsQuery.isLoading && !projectsQuery.isError && !groupsQuery.isError && byGroup.map(({ group, projects: gp }) => (
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
                {gp.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onOpen={() => open(p.id)}
                    onTogglePin={togglePin}
                  />
                ))}
              </div>
            </Section>
          ))}

          {!projectsQuery.isLoading && !groupsQuery.isLoading && !projectsQuery.isError && !groupsQuery.isError && ungrouped.length > 0 && (
            <Section
              label="Ungrouped"
              count={ungrouped.length}
              divider={false}
              marginBottom={48}
              labelSize={13}
            >
              <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
                {ungrouped.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onOpen={() => open(p.id)}
                    onTogglePin={togglePin}
                  />
                ))}
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
          await api.createGroup({ name });
          await invalidateGroups();
        }}
        onRemove={async (id) => {
          await api.deleteGroup(id);
          await Promise.all([invalidateGroups(), invalidateProjects()]);
        }}
        onRename={async (id, name) => {
          await api.updateGroup(id, { name });
          await invalidateGroups();
        }}
      />
      <LaunchKitDialog
        open={showLaunchKit}
        onClose={() => setShowLaunchKit(false)}
        onCreated={(projectId) => {
          setShowLaunchKit(false);
          void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
          void router.navigate({ to: "/projects/$id", params: { id: projectId } });
        }}
      />
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
