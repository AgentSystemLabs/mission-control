import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useCallback, useEffect } from "react";
import { a as api, P as ProjectIcon, B as Btn } from "./router-YiALtSFa.js";
import { u as useServerEvents, E as EmptyState } from "./use-events-D3hEWd0y.js";
import "@tanstack/react-router";
function ArchivePage() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const refresh = useCallback(async () => {
    const [a, p] = await Promise.all([api.listArchive(), api.listProjects()]);
    setTasks(a.tasks);
    setProjects(p.projects);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useServerEvents(useCallback((e) => {
    if (e.type.startsWith("task:")) void refresh();
  }, [refresh]));
  const projectFor = (id) => projects.find((p) => p.id === id);
  return /* @__PURE__ */ jsx("div", { style: {
    flex: 1,
    overflow: "auto",
    padding: "28px 32px 80px"
  }, className: "dot-grid-bg", children: /* @__PURE__ */ jsxs("div", { style: {
    maxWidth: 900,
    margin: "0 auto"
  }, children: [
    /* @__PURE__ */ jsx("h1", { style: {
      margin: "0 0 8px",
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: "-0.015em"
    }, children: "Archive" }),
    /* @__PURE__ */ jsxs("div", { style: {
      fontFamily: "var(--mono)",
      fontSize: 12,
      color: "var(--text-dim)",
      marginBottom: 24
    }, children: [
      tasks.length,
      " archived ",
      tasks.length === 1 ? "task" : "tasks"
    ] }),
    tasks.length === 0 ? /* @__PURE__ */ jsx(EmptyState, { title: "Nothing archived", subtitle: "Completed tasks you archive will show up here.", icon: "archive" }) : /* @__PURE__ */ jsx("div", { style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }, children: tasks.map((t) => {
      const p = projectFor(t.projectId);
      return /* @__PURE__ */ jsxs("div", { style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 8
      }, children: [
        p && /* @__PURE__ */ jsx(ProjectIcon, { project: p, size: 28 }),
        /* @__PURE__ */ jsxs("div", { style: {
          flex: 1,
          minWidth: 0
        }, children: [
          /* @__PURE__ */ jsx("div", { style: {
            fontSize: 13,
            color: "var(--text)"
          }, children: t.title }),
          /* @__PURE__ */ jsxs("div", { style: {
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--text-faint)",
            marginTop: 2
          }, children: [
            p?.name || "(unknown)",
            " · ",
            t.branch,
            " · +",
            t.lines,
            " lines"
          ] })
        ] }),
        /* @__PURE__ */ jsx(Btn, { size: "sm", variant: "ghost", onClick: async () => {
          await api.restoreTask(t.id);
          await refresh();
        }, children: "Restore" })
      ] }, t.id);
    }) })
  ] }) });
}
export {
  ArchivePage as component
};
