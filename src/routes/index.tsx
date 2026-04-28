import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { KbdAction } from "~/components/ui/Kbd";
import { useHotkey } from "~/lib/use-hotkey";
import { useWheelSwipe } from "~/lib/use-wheel-swipe";
import { Section } from "~/components/ui/Section";
import { EmptyState } from "~/components/ui/EmptyState";
import { StatusDot } from "~/components/ui/StatusDot";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { ProjectCard, type Density } from "~/components/views/ProjectCard";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { GroupsDialog } from "~/components/views/GroupsDialog";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { useServerEvents } from "~/lib/use-events";
import { useUserTerminals } from "~/lib/user-terminal-store";
import type { Group } from "~/db/schema";
import type { ProjectWithCounts } from "~/server/services/projects";

export const Route = createFileRoute("/")({
  component: MissionControlPage,
});

function MissionControlPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<Density>("regular");
  const [showAdd, setShowAdd] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const { setProject: setActiveUserTerminalProject } = useUserTerminals();

  // Dashboard has no project context — detach the user-terminal panel from
  // whichever project we were just viewing.
  useEffect(() => {
    setActiveUserTerminalProject(null);
  }, [setActiveUserTerminalProject]);

  useHotkey("search.focus", () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  });

  useHotkey("agent.new", () => setShowAdd(true));

  const refresh = useCallback(async () => {
    const [p, g] = await Promise.all([api.listProjects(), api.listGroups()]);
    setProjects(p.projects);
    setGroups(g.groups);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const goLast = useCallback(() => {
    let lastId: string | null = null;
    try {
      lastId = sessionStorage.getItem("lastProjectId");
    } catch {}
    if (lastId) router.navigate({ to: "/projects/$id", params: { id: lastId } });
  }, [router]);

  useEffect(() => {
    const off = getElectron()?.onSwipe((dir) => {
      if (dir === "right") goLast();
    });
    return () => {
      off?.();
    };
  }, [goLast]);

  useWheelSwipe("right", goLast);

  useServerEvents(
    useCallback(
      (e) => {
        if (
          e.type.startsWith("project:") ||
          e.type.startsWith("group:") ||
          e.type.startsWith("task:")
        ) {
          void refresh();
        }
      },
      [refresh]
    )
  );

  const filter = (p: ProjectWithCounts) =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.path.toLowerCase().includes(search.toLowerCase());

  const pinned = projects.filter((p) => p.pinned && filter(p));
  const byGroup = groups
    .map((g) => ({
      group: g,
      projects: projects.filter((p) => p.groupId === g.id && !p.pinned && filter(p)),
    }))
    .filter((gr) => gr.projects.length > 0);
  const ungrouped = projects.filter((p) => !p.groupId && !p.pinned && filter(p));

  const gridCols =
    density === "compact"
      ? "repeat(auto-fill, minmax(240px, 1fr))"
      : density === "spacious"
        ? "repeat(auto-fill, minmax(360px, 1fr))"
        : "repeat(auto-fill, minmax(300px, 1fr))";

  const totalRunning = projects.reduce((a, p) => a + p.taskCounts.running, 0);
  const totalNeeds = projects.reduce((a, p) => a + p.taskCounts["needs-input"], 0);
  const totalDone = projects.reduce((a, p) => a + p.taskCounts.finished, 0);

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
    await refresh();
  };

  return (
    <>
      <CursorGlow />
      <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }} className="dot-grid-bg">
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginBottom: 24,
              gap: 24,
              flexWrap: "wrap",
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
                Mission Control
              </h1>
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  padding: "0 10px",
                  height: 32,
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

              <div
                role="group"
                aria-label="Card density"
                style={{
                  display: "flex",
                  padding: 2,
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  height: 32,
                }}
              >
                {(["compact", "regular", "spacious"] as Density[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDensity(d)}
                    title={d}
                    aria-label={`${d} density`}
                    aria-pressed={density === d}
                    style={{
                      background: density === d ? "var(--surface-3)" : "transparent",
                      border: 0,
                      color: density === d ? "var(--text)" : "var(--text-dim)",
                      borderRadius: 5,
                      cursor: "pointer",
                      padding: "0 10px",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                    }}
                  >
                    {d === "compact" ? "▪" : d === "regular" ? "▪▪" : "▪▪▪"}
                  </button>
                ))}
              </div>

              <Btn variant="ghost" icon="group" onClick={() => setShowGroups(true)}>
                Groups
              </Btn>
              <Btn variant="ghost" icon="archive" onClick={() => router.navigate({ to: "/archive" })}>
                Archive
              </Btn>
              <Btn variant="primary" icon="plus" onClick={() => setShowAdd(true)}>
                Add project
                <KbdAction action="agent.new" variant="onPrimary" />
              </Btn>
            </div>
          </div>

          {pinned.length > 0 && (
            <Section label="Pinned" count={pinned.length} icon="pin-fill">
              <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
                {pinned.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    density={density}
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
                    density={density}
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
                    density={density}
                    onOpen={() => open(p.id)}
                    onTogglePin={togglePin}
                  />
                ))}
              </div>
            </Section>
          )}

          {projects.filter(filter).length === 0 && (
            <EmptyState
              title={search ? "No matches" : "No projects yet"}
              subtitle={search ? "Try a different search." : "Add your first project to start running agents."}
              action={
                !search && (
                  <Btn variant="primary" icon="plus" onClick={() => setShowAdd(true)}>
                    Add project
                  </Btn>
                )
              }
            />
          )}
        </div>
      </div>

      <ProjectDialog
        open={showAdd}
        project={null}
        groups={groups}
        onClose={() => setShowAdd(false)}
        onSave={async (data) => {
          const { pendingImage, imagePath: _ignore, ...createBody } = data;
          const { project: created } = await api.createProject(createBody);
          if (pendingImage) {
            const electron = (await import("~/lib/electron")).getElectron();
            const result = await electron?.saveProjectImage({
              projectId: created.id,
              sourcePath: pendingImage.sourcePath,
              extension: pendingImage.extension,
            });
            if (result && "filename" in result) {
              await api.updateProject(created.id, { imagePath: result.filename });
            }
          }
          setShowAdd(false);
          await refresh();
        }}
      />
      <GroupsDialog
        open={showGroups}
        groups={groups}
        projects={projects}
        onClose={() => setShowGroups(false)}
        onAdd={async (name) => {
          await api.createGroup({ name });
          await refresh();
        }}
        onRemove={async (id) => {
          await api.deleteGroup(id);
          await refresh();
        }}
        onRename={async (id, name) => {
          await api.updateGroup(id, { name });
          await refresh();
        }}
      />
    </>
  );
}
