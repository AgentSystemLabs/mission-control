import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { ProjectRunningDot } from "~/components/ui/ProjectRunningDot";
import { StatusDot } from "~/components/ui/StatusDot";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { STATUS_META } from "~/lib/design-meta";
import { projectPickerSections } from "~/lib/group-projects";
import type { TaskStatus } from "~/shared/domain";
import { useServerEvents } from "~/lib/use-events";
import { isEditableTarget, useHotkey } from "~/lib/use-hotkey";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { queryKeys, useGroups, useProjects, useScopedProjects } from "~/queries";
import { getProjectActivity, isProjectActive, type ProjectWithCounts } from "~/shared/projects";

function DotCount({ status, count, size }: { status: TaskStatus; count: number; size: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: STATUS_META[status].color }}>
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

export function ProjectPicker({ projectId, disabled = false }: { projectId?: string; disabled?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasRunningLaunchForProject } = useUserTerminals();
  const [open, setOpen] = useState(false);
  const { data: allProjects } = useProjects();
  const { data: projects } = useScopedProjects();
  const { data: groups = [] } = useGroups();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const current = allProjects?.find((p) => p.id === projectId) ?? null;
  const label = current?.name ?? "Project";

  const filtered = useMemo<ProjectWithCounts[]>(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  // Mirrors the landing page layout so the affordance is consistent.
  const sections = useMemo(() => projectPickerSections(filtered, groups), [filtered, groups]);
  const launchRunningProjectIds = useMemo(
    () =>
      new Set(
        (allProjects ?? [])
          .filter((project) => hasRunningLaunchForProject(project.id, project.launchCommands))
          .map((project) => project.id),
      ),
    [allProjects, hasRunningLaunchForProject],
  );

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

  useHotkey(
    "project.picker",
    (e) => {
      if (disabled) return;
      if (isEditableTarget(e.target) && !wrapRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      setOpen((o) => !o);
    },
    { preventDefault: false },
  );

  // Force-close if the picker becomes disabled (e.g. the active sandbox starts resuming).
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

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
      setOpen(false);
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
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {current && <ProjectIcon project={current} size={14} />}
          <span>{label}</span>
          <Icon name="chevron-down" size={11} style={{ color: "var(--text-faint)" }} />
        </Btn>
      </HotkeyTooltip>
      {open && (
        <CardFrame
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
                          <ProjectRunningDot running={isProjectActive(getProjectActivity(p, launchRunningProjectIds))} size={7} />
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
        </CardFrame>
      )}
    </div>
  );
}
