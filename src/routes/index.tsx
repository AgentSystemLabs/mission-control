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
  groupsQueryOptions,
  projectsQueryOptions,
  queryKeys,
  useGroups,
  useLicense,
  useProjects,
} from "~/queries";
import type { ProjectWithCounts } from "~/shared/projects";
import { isAcademyTier } from "~/shared/license";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectsQueryOptions()),
      context.queryClient.ensureQueryData(groupsQueryOptions()),
    ]),
  component: MissionControlPage,
});

const DASHBOARD_QUOTES = [
  "Let's build something awesome today.",
  "Let's ship one clean win today.",
  "Time to make the work real.",
  "Let's turn ideas into motion.",
  "Build the next useful thing.",
  "Let's make progress visible.",
  "Start sharp and keep moving.",
  "One focused pass changes everything.",
  "Let's make today count.",
  "Small steps still ship products.",
  "Turn the plan into proof.",
  "Let's build with intent today.",
  "Make the next version better.",
  "Pick the thread and pull.",
  "Let's clear the path forward.",
  "Good work starts with one move.",
  "Shape the system with care.",
  "Let's solve the right problem.",
  "Make the useful thing obvious.",
  "Today's build starts here.",
  "Let's bring the idea closer.",
  "Steady hands, sharp output.",
  "Move the product forward.",
  "Let's turn focus into leverage.",
  "Build the thing worth opening.",
  "Let's make the interface earn trust.",
  "Commit to the next clear action.",
  "Make the work easier to use.",
  "Let's give the project momentum.",
  "The next improvement is waiting.",
  "Build what future you needs.",
  "Let's reduce friction today.",
  "Put another piece in place.",
  "Make the complex feel simple.",
  "Let's keep the machine honest.",
  "Create something worth returning to.",
  "Let's make the rough edge smooth.",
  "Turn attention into progress.",
  "Build calmly and ship clearly.",
  "Let's make one thing unmistakably better.",
  "The product moves when you do.",
  "Make today's work durable.",
  "Let's tighten the loop.",
  "Solve it cleanly, then ship it.",
  "Build the path users expect.",
  "Let's make the next click matter.",
  "Bring order to the workbench.",
  "Let's turn possibility into behavior.",
  "Make the dashboard earn its keep.",
  "Build with taste and precision.",
  "Let's make the work feel lighter.",
  "One good decision compounds.",
  "Turn the backlog into motion.",
  "Let's polish the part that matters.",
  "Make the system easier to trust.",
  "Build the next honest improvement.",
  "Let's move from intent to artifact.",
  "Give the project a clean push.",
  "Make something useful before lunch.",
  "Let's build the future in increments.",
];

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
  const [dashboardQuote, setDashboardQuote] = useState(DASHBOARD_QUOTES[0]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const { setProject: setActiveUserTerminalProject } = useUserTerminals();
  const { open: openAddProject } = useAddProject();

  // Dashboard has no project context — detach the user-terminal panel from
  // whichever project we were just viewing.
  useEffect(() => {
    setActiveUserTerminalProject(null);
  }, [setActiveUserTerminalProject]);

  useEffect(() => {
    setDashboardQuote(DASHBOARD_QUOTES[Math.floor(Math.random() * DASHBOARD_QUOTES.length)]);
  }, []);

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

  const open = (id: string) => router.navigate({ to: "/projects/$id", params: { id } });
  const togglePin = async (id: string) => {
    await api.togglePin(id);
    await invalidateProjects();
  };
  const canUseLaunchKit =
    (!!license && isAcademyTier(license)) || !!launchKitAccess.data?.hasAccess;

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
            className="mc-dashboard-header"
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
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
                <span style={{ color: "var(--accent)" }}>Welcome back</span>, Commander
              </h1>
              <div style={{ marginTop: 4, fontSize: 14, color: "var(--text-dim)" }}>
                "{dashboardQuote}"
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

          {byGroup.map(({ group, projects: gp }) => (
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

          {ungrouped.length > 0 && (
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
