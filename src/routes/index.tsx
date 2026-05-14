import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { KbdAction } from "~/components/ui/Kbd";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { groupProjects } from "~/lib/group-projects";
import { Section } from "~/components/ui/Section";
import { EmptyState } from "~/components/ui/EmptyState";
import { StatusDot } from "~/components/ui/StatusDot";
import { ProjectCard } from "~/components/views/ProjectCard";
import { GroupsDialog } from "~/components/views/GroupsDialog";
import { LaunchKitDialog } from "~/components/views/LaunchKitDialog";
import { useAddProject } from "~/lib/add-project-store";
import { ApiError, api } from "~/lib/api";
import { getRuntime } from "~/lib/runtime";
import { useServerEvents } from "~/lib/use-events";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  groupsQueryOptions,
  projectsQueryOptions,
  queryKeys,
  useGroups,
  useLicense,
  useProjects,
} from "~/queries";
import type { ProjectWithCounts } from "~/shared/projects";
import { isAcademyTier } from "~/shared/license";
import { RouteErrorBoundary } from "~/components/ui/RouteErrorBoundary";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    try {
      await Promise.all([
        context.queryClient.ensureQueryData(projectsQueryOptions()),
        context.queryClient.ensureQueryData(groupsQueryOptions()),
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      throw error;
    }
  },
  component: MissionControlPage,
  errorComponent: ({ error, reset }) => (
    <RouteErrorBoundary error={error} reset={reset} />
  ),
});

function MissionControlPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useProjects();
  const { data: groups = [] } = useGroups();
  const { data: license } = useLicense();
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

  const gridCols = "repeat(auto-fill, minmax(300px, 1fr))";

  const totalRunning = projects.reduce((a, p) => a + p.taskCounts.running, 0);
  const totalNeeds = projects.reduce((a, p) => a + p.taskCounts["needs-input"], 0);
  const totalInterrupted = projects.reduce((a, p) => a + p.taskCounts.interrupted, 0);
  const totalDone = projects.reduce((a, p) => a + p.taskCounts.finished, 0);

  const [firstName, setFirstName] = useState<string | null>(null);
  useEffect(() => {
    const runtime = getRuntime();
    if (!runtime) return;
    let cancelled = false;
    void runtime.getUserName().then((r) => {
      if (!cancelled) setFirstName(r.firstName);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    []
  );

  const open = (id: string) => router.navigate({ to: "/projects/$id", params: { id } });
  const togglePin = async (id: string) => {
    await api.togglePin(id);
    await invalidateProjects();
  };
  const canUseLaunchKit =
    (!!license && isAcademyTier(license)) || !!launchKitAccess.data?.hasAccess;

  return (
    <>
      <div style={{ flex: 1, overflow: "auto", padding: 0 }} className="dot-grid-bg">
        <CardFrame
          style={{
            width: "100%",
            minHeight: "100%",
            padding: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginBottom: 24,
              gap: 24,
              flexWrap: "wrap",
              paddingInline: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-faint)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                ✦ {dateLabel}
              </div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
                <span style={{ color: "var(--accent)" }}>{greeting}</span>
                {firstName ? `, ${firstName}` : ""}
              </h1>
              <div style={{ marginTop: 4, fontSize: 14, color: "var(--text-dim)" }}>
                Here's what's running today.
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  marginTop: 10,
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--text-dim)",
                }}
              >
                <span>
                  <StatusDot status="running" />{" "}
                  <span
                    style={{
                      color: "var(--text)",
                      marginLeft: 6,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {totalRunning}
                  </span>{" "}
                  running
                </span>
                <span>
                  <StatusDot status="interrupted" />{" "}
                  <span
                    style={{
                      color: "var(--text)",
                      marginLeft: 6,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {totalInterrupted}
                  </span>{" "}
                  interrupted
                </span>
                <span>
                  <StatusDot status="needs-input" />{" "}
                  <span
                    style={{
                      color: "var(--text)",
                      marginLeft: 6,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {totalNeeds}
                  </span>{" "}
                  awaiting input
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      background: "var(--status-done)",
                    }}
                  />
                  <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                    {totalDone}
                  </span>{" "}
                  ready
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

          {pinned.length > 0 && (
            <Section label="Pinned" count={pinned.length} icon="pin-fill">
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

          {byGroup.map(({ group, projects: gp }) => (
            <Section key={group.id} label={group.name} count={gp.length} dot={group.color}>
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

          {ungrouped.length > 0 && (
            <Section label="Ungrouped" count={ungrouped.length}>
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

          {filteredProjects.length === 0 && (
            <EmptyState
              title={search ? "No matches" : "No projects yet"}
              subtitle={search ? "Try a different search." : "Add your first project to start running sessions."}
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
