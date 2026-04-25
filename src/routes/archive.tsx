import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { EmptyState } from "~/components/ui/EmptyState";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { api } from "~/lib/api";
import { useServerEvents } from "~/lib/use-events";
import type { Task } from "~/db/schema";
import type { ProjectWithCounts } from "~/server/services/projects";

export const Route = createFileRoute("/archive")({
  component: ArchivePage,
});

function ArchivePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);

  const refresh = useCallback(async () => {
    const [a, p] = await Promise.all([api.listArchive(), api.listProjects()]);
    setTasks(a.tasks);
    setProjects(p.projects);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("task:")) void refresh();
      },
      [refresh]
    )
  );

  const projectFor = (id: string) => projects.find((p) => p.id === id);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }} className="dot-grid-bg">
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
          Archive
        </h1>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text-dim)",
            marginBottom: 24,
          }}
        >
          {tasks.length} archived {tasks.length === 1 ? "task" : "tasks"}
        </div>
        {tasks.length === 0 ? (
          <EmptyState
            title="Nothing archived"
            subtitle="Completed tasks you archive will show up here."
            icon="archive"
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tasks.map((t) => {
              const p = projectFor(t.projectId);
              return (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  {p && <ProjectIcon project={p} size={28} />}
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
                      {p?.name || "(unknown)"} · {t.branch} · +{t.lines} lines
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
