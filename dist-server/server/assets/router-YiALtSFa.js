import { createRootRoute, HeadContent, Scripts, useRouter, Outlet, createFileRoute, lazyRouteComponent, createRouter } from "@tanstack/react-router";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
function Icon({ name, size = 14, style }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style
  };
  switch (name) {
    case "plus":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M8 3v10M3 8h10" }) });
    case "pin":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M10 2l4 4-2 1-1 4-3-3-4 4 4-4-3-3 4-1 1-2z" }) });
    case "pin-fill":
      return /* @__PURE__ */ jsx("svg", { ...common, fill: "currentColor", stroke: "none", children: /* @__PURE__ */ jsx("path", { d: "M10.5 1.8l3.7 3.7-1.9 1-1.1 3.9-2.8-2.8-4.2 4.2 4.2-4.2-2.8-2.8 3.9-1.1 1-1.9z" }) });
    case "search":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("circle", { cx: "7", cy: "7", r: "4.5" }),
        /* @__PURE__ */ jsx("path", { d: "M13.5 13.5l-3-3" })
      ] });
    case "grid":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("rect", { x: "2", y: "2", width: "5", height: "5" }),
        /* @__PURE__ */ jsx("rect", { x: "9", y: "2", width: "5", height: "5" }),
        /* @__PURE__ */ jsx("rect", { x: "2", y: "9", width: "5", height: "5" }),
        /* @__PURE__ */ jsx("rect", { x: "9", y: "9", width: "5", height: "5" })
      ] });
    case "list":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M2 4h12M2 8h12M2 12h12" }) });
    case "folder":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M2 4.5c0-.5.4-1 1-1h3l1.5 1.5H13c.5 0 1 .5 1 1V12c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1V4.5z" }) });
    case "terminal":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("rect", { x: "1.5", y: "2.5", width: "13", height: "11", rx: "1" }),
        /* @__PURE__ */ jsx("path", { d: "M4 6l2 2-2 2M8 10h4" })
      ] });
    case "chevron-right":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M6 3l5 5-5 5" }) });
    case "chevron-down":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M3 6l5 5 5-5" }) });
    case "chevron-left":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M10 3L5 8l5 5" }) });
    case "x":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M3 3l10 10M13 3L3 13" }) });
    case "more":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("circle", { cx: "3", cy: "8", r: "1", fill: "currentColor" }),
        /* @__PURE__ */ jsx("circle", { cx: "8", cy: "8", r: "1", fill: "currentColor" }),
        /* @__PURE__ */ jsx("circle", { cx: "13", cy: "8", r: "1", fill: "currentColor" })
      ] });
    case "check":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M3 8l3 3 7-7" }) });
    case "archive":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("rect", { x: "1.5", y: "3", width: "13", height: "3" }),
        /* @__PURE__ */ jsx("path", { d: "M3 6v7h10V6M6 9h4" })
      ] });
    case "settings":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("circle", { cx: "8", cy: "8", r: "2" }),
        /* @__PURE__ */ jsx("path", { d: "M8 1v2M8 13v2M15 8h-2M3 8H1M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4M12.9 12.9l-1.4-1.4M4.5 4.5L3.1 3.1" })
      ] });
    case "git-branch":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("circle", { cx: "4", cy: "3", r: "1.5" }),
        /* @__PURE__ */ jsx("circle", { cx: "4", cy: "13", r: "1.5" }),
        /* @__PURE__ */ jsx("circle", { cx: "12", cy: "6", r: "1.5" }),
        /* @__PURE__ */ jsx("path", { d: "M4 4.5v7M4 9c0-2.5 2-3 4-3" })
      ] });
    case "home":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M2 7l6-5 6 5v6.5c0 .3-.2.5-.5.5H10V9H6v5H2.5c-.3 0-.5-.2-.5-.5V7z" }) });
    case "play":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M4 3l9 5-9 5V3z", fill: "currentColor" }) });
    case "upload":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M8 11V3M4 7l4-4 4 4M2 13h12" }) });
    case "group":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("rect", { x: "1.5", y: "3", width: "5", height: "5" }),
        /* @__PURE__ */ jsx("rect", { x: "9.5", y: "3", width: "5", height: "5" }),
        /* @__PURE__ */ jsx("rect", { x: "5.5", y: "9", width: "5", height: "5" })
      ] });
    case "refresh":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M14 3v4h-4M2 13V9h4M13 7a5 5 0 00-9-2M3 9a5 5 0 009 2" }) });
    case "sparkles":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2L8 2zM12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L10.5 13l1.4-.6.6-1.4z" }) });
    case "copy":
      return /* @__PURE__ */ jsxs("svg", { ...common, children: [
        /* @__PURE__ */ jsx("rect", { x: "5", y: "5", width: "9", height: "9", rx: "1" }),
        /* @__PURE__ */ jsx("path", { d: "M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" })
      ] });
    case "trash":
      return /* @__PURE__ */ jsx("svg", { ...common, children: /* @__PURE__ */ jsx("path", { d: "M2.5 4h11M6 4V2.5h4V4M3.5 4l.7 9.1c0 .5.4.9.9.9h5.8c.5 0 .9-.4.9-.9L12.5 4M6.5 7v4M9.5 7v4" }) });
    default:
      return null;
  }
}
function TopBar({
  crumbs,
  right,
  onHome
}) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 48,
        padding: "0 20px",
        background: "var(--surface-0)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
        ["WebkitAppRegion"]: "drag"
      },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 10,
              paddingLeft: 60,
              // room for macOS traffic lights
              ["WebkitAppRegion"]: "no-drag"
            },
            children: [
              /* @__PURE__ */ jsxs("div", { onClick: onHome, style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    style: {
                      width: 22,
                      height: 22,
                      borderRadius: 5,
                      background: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#0a0b0d",
                      fontFamily: "var(--mono)",
                      fontSize: 13,
                      fontWeight: 700
                    },
                    children: "M"
                  }
                ),
                /* @__PURE__ */ jsx(
                  "span",
                  {
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      letterSpacing: "0.02em"
                    },
                    children: "MissionControl"
                  }
                )
              ] }),
              crumbs && crumbs.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsx(Icon, { name: "chevron-right", size: 11, style: { color: "var(--text-faint)" } }),
                crumbs.map((c, i) => /* @__PURE__ */ jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 10 }, children: [
                  i > 0 && /* @__PURE__ */ jsx(Icon, { name: "chevron-right", size: 11, style: { color: "var(--text-faint)" } }),
                  /* @__PURE__ */ jsx(
                    "span",
                    {
                      onClick: c.onClick,
                      style: {
                        fontFamily: "var(--mono)",
                        fontSize: 12,
                        color: i === crumbs.length - 1 ? "var(--text)" : "var(--text-dim)",
                        cursor: c.onClick ? "pointer" : "default"
                      },
                      children: c.label
                    }
                  )
                ] }, i))
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              ["WebkitAppRegion"]: "no-drag"
            },
            children: right
          }
        )
      ]
    }
  );
}
const VARIANT_STYLES = {
  ghost: { background: "transparent", border: "1px solid var(--border)", color: "var(--text-dim)" },
  solid: {
    background: "var(--surface-2)",
    border: "1px solid var(--border-strong)",
    color: "var(--text)"
  },
  accent: {
    background: "var(--accent-dim)",
    border: "1px solid var(--accent)",
    color: "var(--accent)"
  },
  primary: { background: "var(--accent)", border: "1px solid var(--accent)", color: "#0a0b0d" },
  danger: { background: "transparent", border: "1px solid var(--border)", color: "var(--status-failed)" }
};
const SIZE_STYLES = {
  sm: { height: 24, padding: "0 8px", fontSize: 11, gap: 5 },
  md: { height: 30, padding: "0 12px", fontSize: 12.5, gap: 6 },
  lg: { height: 36, padding: "0 16px", fontSize: 13, gap: 7 }
};
const HOVER_BG = {
  primary: "oklch(0.87 0.17 145)",
  ghost: "var(--surface-1)",
  accent: "oklch(0.82 0.17 145 / 0.22)",
  solid: "var(--surface-3)",
  danger: "var(--surface-1)"
};
function Btn({
  variant = "ghost",
  size = "md",
  icon,
  children,
  style,
  ...rest
}) {
  return /* @__PURE__ */ jsxs(
    "button",
    {
      ...rest,
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        fontFamily: "var(--sans)",
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
        whiteSpace: "nowrap",
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        ...style
      },
      onMouseEnter: (e) => {
        e.currentTarget.style.background = HOVER_BG[variant];
      },
      onMouseLeave: (e) => {
        e.currentTarget.style.background = VARIANT_STYLES[variant].background;
      },
      children: [
        icon && /* @__PURE__ */ jsx(Icon, { name: icon, size: size === "sm" ? 11 : 13 }),
        children
      ]
    }
  );
}
const KEY$1 = "mc.theme";
function useTheme() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY$1) ?? "dark";
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } catch {
    }
  }, []);
  const set = (t) => {
    setTheme(t);
    try {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem(KEY$1, t);
    } catch {
    }
  };
  const toggle = () => set(theme === "dark" ? "light" : "dark");
  return { theme, toggle, set };
}
function getElectron() {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}
const AGENT_META = {
  "claude-code": { label: "Claude Code", color: "#d6a56b", glyph: "◆", cmd: "claude" },
  codex: { label: "Codex", color: "#8ab4ff", glyph: "◇", cmd: "codex" },
  "cursor-cli": { label: "Cursor CLI", color: "#c792ea", glyph: "▲", cmd: "cursor-agent" },
  shell: { label: "Shell", color: "#7ce58a", glyph: "❯", cmd: "$SHELL" }
};
const STATUS_META = {
  running: { label: "Running", color: "var(--status-running)", dot: true, shimmer: true },
  "needs-input": { label: "Needs input", color: "var(--status-needs)", dot: true, shimmer: false },
  done: { label: "Done", color: "var(--status-done)", dot: false, shimmer: false },
  idle: { label: "Idle", color: "var(--status-idle)", dot: false, shimmer: false },
  failed: { label: "Failed", color: "var(--status-failed)", dot: true, shimmer: false }
};
const ICON_COLORS = ["#7ce58a", "#8ab4ff", "#c792ea", "#fbbf24", "#f472b6", "#34d399", "#fb923c"];
const TerminalContext = createContext(null);
const MAX_PANES = 4;
function commandFor(agent) {
  if (agent === "shell") return "";
  return AGENT_META[agent].cmd;
}
function TerminalProvider({ children }) {
  const [open, setOpen] = useState([]);
  const killPty = async (id) => {
    if (!id) return;
    const electron = getElectron();
    if (!electron) return;
    await electron.pty.kill(id).catch(() => void 0);
  };
  const toggle = useCallback((project, task) => {
    setOpen((prev) => {
      const existing = prev.find((p) => p.taskId === task.id);
      if (existing) {
        void killPty(existing.ptyId);
        return prev.filter((p) => p.taskId !== task.id);
      }
      const next = {
        taskId: task.id,
        ptyId: null,
        startCommand: commandFor(task.agent),
        cwd: project.path,
        project,
        task
      };
      const arr = [...prev, next];
      while (arr.length > MAX_PANES) {
        const dropped = arr.shift();
        if (dropped) void killPty(dropped.ptyId);
      }
      return arr;
    });
  }, []);
  const close = useCallback(async (taskId) => {
    setOpen((prev) => {
      const target = prev.find((p) => p.taskId === taskId);
      if (target) void killPty(target.ptyId);
      return prev.filter((p) => p.taskId !== taskId);
    });
  }, []);
  const closeAll = useCallback(async () => {
    setOpen((prev) => {
      for (const t of prev) void killPty(t.ptyId);
      return [];
    });
  }, []);
  const closeForProject = useCallback(async (projectId) => {
    setOpen((prev) => {
      const remaining = [];
      for (const t of prev) {
        if (t.project.id === projectId) {
          void killPty(t.ptyId);
        } else {
          remaining.push(t);
        }
      }
      return remaining;
    });
  }, []);
  const setPtyId = useCallback((taskId, ptyId) => {
    setOpen((prev) => prev.map((p) => p.taskId === taskId ? { ...p, ptyId } : p));
  }, []);
  const isOpen = useCallback(
    (taskId) => open.some((p) => p.taskId === taskId),
    [open]
  );
  const runIn = useCallback(
    async (taskId, command) => {
      const electron = getElectron();
      if (!electron) return;
      const target = open.find((p) => p.taskId === taskId);
      if (!target?.ptyId) return;
      await electron.pty.write(target.ptyId, command + "\r");
    },
    [open]
  );
  return /* @__PURE__ */ jsx(
    TerminalContext.Provider,
    {
      value: {
        open,
        isOpen,
        toggle,
        close,
        closeAll,
        setPtyId,
        closeForProject,
        startCommandFor: commandFor,
        runIn
      },
      children
    }
  );
}
function useTerminals() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminals must be used inside TerminalProvider");
  return ctx;
}
function ProjectIcon({ project, size = 36 }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: `linear-gradient(135deg, ${project.iconColor}22, ${project.iconColor}08)`,
        border: `1px solid ${project.iconColor}33`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--mono)",
        fontSize: size * 0.36,
        fontWeight: 600,
        color: project.iconColor,
        letterSpacing: "-0.02em",
        flexShrink: 0
      },
      children: project.icon
    }
  );
}
function ShimmerBar({ active, color }) {
  if (!active) {
    return /* @__PURE__ */ jsx("div", { style: { height: 2, background: "var(--border)" } });
  }
  const c = color || "var(--accent)";
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: "shimmer-bar",
      style: {
        ["--shimmer-c"]: c,
        background: `linear-gradient(90deg, transparent 0%, transparent 25%, ${c} 50%, transparent 75%, transparent 100%)`,
        backgroundSize: "200% 100%"
      }
    }
  );
}
function StatusDot({ status, size = 6 }) {
  const meta = STATUS_META[status];
  if (!meta || !meta.dot) return null;
  return /* @__PURE__ */ jsx(
    "span",
    {
      style: {
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: meta.color,
        boxShadow: status === "running" ? `0 0 8px ${meta.color}` : "none",
        animation: status === "running" ? "pulse-dot 1.6s ease-in-out infinite" : "none",
        flexShrink: 0
      }
    }
  );
}
function StatusPill({ status, count }) {
  const meta = STATUS_META[status];
  return /* @__PURE__ */ jsxs(
    "span",
    {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px 2px 7px",
        borderRadius: 999,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--text-dim)",
        lineHeight: 1.4
      },
      children: [
        /* @__PURE__ */ jsx(StatusDot, { status }),
        count != null && /* @__PURE__ */ jsx("span", { style: { color: "var(--text)", fontVariantNumeric: "tabular-nums" }, children: count }),
        /* @__PURE__ */ jsx("span", { children: meta.label.toLowerCase() })
      ]
    }
  );
}
async function req(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers ?? {}
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return void 0;
  return await res.json();
}
const api = {
  listProjects: () => req("/api/projects"),
  getProject: (id) => req(`/api/projects/${id}`),
  createProject: (body) => req("/api/projects", {
    method: "POST",
    body: JSON.stringify(body)
  }),
  updateProject: (id, body) => req(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  }),
  togglePin: (id) => req(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ togglePin: true })
  }),
  deleteProject: (id) => req(`/api/projects/${id}`, { method: "DELETE" }),
  listGroups: () => req("/api/groups"),
  createGroup: (body) => req("/api/groups", {
    method: "POST",
    body: JSON.stringify(body)
  }),
  updateGroup: (id, body) => req(`/api/groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  }),
  deleteGroup: (id) => req(`/api/groups/${id}`, { method: "DELETE" }),
  listTasks: (projectId) => req(`/api/projects/${projectId}/tasks`),
  archiveTask: (id) => req(`/api/tasks/${id}/archive`, { method: "POST" }),
  restoreTask: (id) => req(`/api/tasks/${id}/restore`, { method: "POST" }),
  updateTaskStatus: (id, body, token) => req(`/api/tasks/${id}/status`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}` }
  }),
  createTaskInternal: (projectId, body, token) => req(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}` }
  }),
  deleteTask: (id) => req(`/api/tasks/${id}`, { method: "DELETE" }),
  listArchive: () => req("/api/archive"),
  getSettings: () => req("/api/settings"),
  regenerateToken: () => req("/api/settings", {
    method: "POST",
    body: JSON.stringify({ regenerate: true })
  })
};
async function resolveMcEnv(electron) {
  try {
    const [port, settings] = await Promise.all([
      electron.getRuntimePort(),
      api.getSettings()
    ]);
    if (!port) return void 0;
    return { apiUrl: `http://127.0.0.1:${port}`, token: settings.apiToken };
  } catch {
    return void 0;
  }
}
function TerminalPane({
  project,
  task,
  onClose,
  isLast,
  descriptor,
  onPtyReady
}) {
  const containerRef = useRef(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";
  useEffect(() => {
    const electron = getElectron();
    if (!electron) {
      setBridgeMissing(true);
      return;
    }
    if (!containerRef.current) return;
    let cancelled = false;
    let cleanup;
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit")
      ]);
      if (cancelled || !containerRef.current) return;
      const term = new Terminal({
        fontFamily: 'Geist Mono, ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.4,
        cursorBlink: true,
        theme: {
          background: "#050607",
          foreground: "#e8e6df",
          cursor: meta?.color ?? "#7ce58a",
          black: "#0a0b0d",
          brightBlack: "#22262c",
          white: "#e8e6df",
          brightWhite: "#ffffff"
        },
        allowProposedApi: true,
        scrollback: 5e3
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      const subscriptions = [];
      let rafHandle = 0;
      const wireToPty = (ptyId) => {
        subscriptions.push(
          electron.pty.onData((msg) => {
            if (msg.ptyId === ptyId) term.write(msg.data);
          }),
          electron.pty.onExit((msg) => {
            if (msg.ptyId === ptyId) {
              term.writeln("");
              term.writeln(`\x1B[2m[process exited (code=${msg.exitCode})]\x1B[0m`);
            }
          })
        );
        term.onData((data) => {
          electron.pty.write(ptyId, data);
        });
        term.onResize(({ cols, rows }) => {
          electron.pty.resize(ptyId, cols, rows);
        });
      };
      const ensurePty = async () => {
        if (cancelled) return;
        try {
          try {
            fit.fit();
          } catch {
          }
          if (descriptor.ptyId) {
            wireToPty(descriptor.ptyId);
            const buf = await electron.pty.replay(descriptor.ptyId);
            if (!cancelled && buf) term.write(buf);
            return;
          }
          const mcEnv = await resolveMcEnv(electron);
          const { ptyId } = await electron.pty.spawn({
            taskId: descriptor.taskId,
            cwd: descriptor.cwd,
            command: descriptor.startCommand,
            cols: term.cols,
            rows: term.rows,
            agent: task.agent,
            mcEnv
          });
          if (cancelled) {
            await electron.pty.kill(ptyId).catch(() => void 0);
            return;
          }
          onPtyReady(ptyId);
          wireToPty(ptyId);
        } catch (err) {
          term.writeln(`\x1B[31m[failed to start pty: ${err?.message || err}]\x1B[0m`);
        }
      };
      rafHandle = window.requestAnimationFrame(() => ensurePty());
      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
        }
      });
      ro.observe(containerRef.current);
      cleanup = () => {
        cancelAnimationFrame(rafHandle);
        for (const off of subscriptions) off();
        ro.disconnect();
        term.dispose();
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [descriptor.taskId]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        flex: 1,
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        borderBottom: isLast ? "none" : "1px solid var(--border)",
        overflow: "hidden"
      },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: "var(--surface-1)",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0
            },
            children: [
              /* @__PURE__ */ jsx(StatusDot, { status: task.status, size: 7 }),
              /* @__PURE__ */ jsx(ProjectIcon, { project, size: 20 }),
              /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0, overflow: "hidden" }, children: [
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    },
                    children: task.title
                  }
                ),
                /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      display: "flex",
                      gap: 8,
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--text-faint)",
                      marginTop: 1
                    },
                    children: [
                      /* @__PURE__ */ jsxs("span", { style: { color: meta?.color }, children: [
                        meta?.glyph,
                        " ",
                        meta?.label
                      ] }),
                      /* @__PURE__ */ jsx("span", { children: "·" }),
                      /* @__PURE__ */ jsx("span", { children: project.name }),
                      /* @__PURE__ */ jsx("span", { children: "·" }),
                      /* @__PURE__ */ jsx("span", { style: { color: statusMeta.color }, children: statusMeta.label })
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: onClose,
                  style: {
                    background: "transparent",
                    border: 0,
                    padding: 4,
                    color: "var(--text-faint)",
                    cursor: "pointer",
                    display: "flex"
                  },
                  title: "Close",
                  children: /* @__PURE__ */ jsx(Icon, { name: "x", size: 11 })
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsx(ShimmerBar, { active: isRunning, color: meta?.color }),
        /* @__PURE__ */ jsx("div", { style: { flex: 1, position: "relative", background: "#050607" }, children: bridgeMissing ? /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              padding: 16,
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-dim)"
            },
            children: [
              "Terminals require the Electron runtime. Open MissionControl through",
              " ",
              /* @__PURE__ */ jsx("code", { style: { color: "var(--accent)" }, children: "pnpm dev" }),
              "."
            ]
          }
        ) : /* @__PURE__ */ jsx("div", { ref: containerRef, style: { position: "absolute", inset: 0 } }) })
      ]
    }
  );
}
function TerminalPanel({
  open,
  onClose,
  onCloseAll,
  onPtyReady
}) {
  if (open.length === 0) return null;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        width: 560,
        minWidth: 380,
        background: "#050607",
        borderLeft: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        animation: "slide-right 0.2s ease-out"
      },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              background: "var(--surface-0)",
              flexShrink: 0
            },
            children: [
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
                /* @__PURE__ */ jsx(Icon, { name: "terminal", size: 13, style: { color: "var(--accent)" } }),
                /* @__PURE__ */ jsx(
                  "span",
                  {
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      fontWeight: 600,
                      letterSpacing: "0.02em"
                    },
                    children: "Terminals"
                  }
                ),
                /* @__PURE__ */ jsx("span", { style: { fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }, children: open.length })
              ] }),
              /* @__PURE__ */ jsxs(
                "button",
                {
                  onClick: async () => {
                    const electron = getElectron();
                    for (const t of open) {
                      if (t.ptyId && electron) await electron.pty.kill(t.ptyId).catch(() => void 0);
                    }
                    onCloseAll();
                  },
                  style: {
                    background: "transparent",
                    border: "1px solid var(--border)",
                    color: "var(--text-dim)",
                    padding: "3px 8px",
                    borderRadius: 5,
                    cursor: "pointer",
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5
                  },
                  children: [
                    /* @__PURE__ */ jsx(Icon, { name: "x", size: 10 }),
                    " Close all"
                  ]
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsx("div", { style: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }, children: open.map((t, i) => /* @__PURE__ */ jsx(
          TerminalPane,
          {
            project: t.project,
            task: t.task,
            descriptor: t,
            isLast: i === open.length - 1,
            onClose: async () => {
              const electron = getElectron();
              if (t.ptyId && electron) await electron.pty.kill(t.ptyId).catch(() => void 0);
              onClose(t.taskId);
            },
            onPtyReady: (ptyId) => onPtyReady(t.taskId, ptyId)
          },
          t.taskId
        )) })
      ]
    }
  );
}
const DEFAULTS = {
  theme: "dark",
  density: "regular",
  accent: "#7ce58a",
  activity: "shimmer"
};
const KEY = "mc.tweaks";
function applyToDocument(t) {
  document.documentElement.setAttribute("data-theme", t.theme);
  document.documentElement.style.setProperty("--accent", t.accent);
  document.documentElement.style.setProperty("--accent-dim", t.accent + "26");
  document.documentElement.style.setProperty("--accent-faint", t.accent + "14");
  document.documentElement.style.setProperty("--status-running", t.accent);
  document.documentElement.setAttribute("data-density", t.density);
  document.documentElement.setAttribute("data-activity", t.activity);
}
function useTweaks() {
  const [tweaks, setTweaks] = useState(DEFAULTS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = { ...DEFAULTS, ...JSON.parse(raw) };
        setTweaks(saved);
        applyToDocument(saved);
      } else {
        applyToDocument(DEFAULTS);
      }
    } catch {
      applyToDocument(DEFAULTS);
    }
  }, []);
  const setTweak = useCallback((key, value) => {
    setTweaks((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
      }
      applyToDocument(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    setTweaks(DEFAULTS);
    try {
      localStorage.removeItem(KEY);
    } catch {
    }
    applyToDocument(DEFAULTS);
  }, []);
  return { tweaks, setTweak, reset };
}
function TweaksLauncher() {
  const [open, setOpen] = useState(false);
  const { tweaks, setTweak, reset } = useTweaks();
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        onClick: () => setOpen((v) => !v),
        title: "Tweaks (⌘.)",
        style: {
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 90,
          width: 36,
          height: 36,
          borderRadius: 18,
          background: "var(--surface-1)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 14px rgba(0,0,0,0.32)"
        },
        children: /* @__PURE__ */ jsx(Icon, { name: "sparkles", size: 14 })
      }
    ),
    open && /* @__PURE__ */ jsx(TweaksPanel, { tweaks, setTweak, reset, onClose: () => setOpen(false) })
  ] });
}
function TweaksPanel({
  tweaks,
  setTweak,
  reset,
  onClose
}) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        position: "fixed",
        right: 16,
        bottom: 64,
        zIndex: 91,
        width: 280,
        maxHeight: "calc(100vh - 96px)",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-1)",
        border: "1px solid var(--border-strong)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset",
        overflow: "hidden",
        animation: "fade-up 0.12s ease-out"
      },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              background: "var(--surface-0)"
            },
            children: [
              /* @__PURE__ */ jsx(
                "span",
                {
                  style: {
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--text)"
                  },
                  children: "Tweaks"
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: onClose,
                  style: {
                    background: "transparent",
                    border: 0,
                    color: "var(--text-faint)",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex"
                  },
                  children: /* @__PURE__ */ jsx(Icon, { name: "x", size: 12 })
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsxs("div", { style: { padding: 14, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }, children: [
          /* @__PURE__ */ jsx(Section, { label: "Appearance" }),
          /* @__PURE__ */ jsx(
            Segmented,
            {
              label: "Theme",
              value: tweaks.theme,
              options: ["dark", "light"],
              onChange: (v) => setTweak("theme", v)
            }
          ),
          /* @__PURE__ */ jsx(
            ColorRow,
            {
              label: "Accent",
              value: tweaks.accent,
              onChange: (v) => setTweak("accent", v)
            }
          ),
          /* @__PURE__ */ jsx(
            Segmented,
            {
              label: "Density",
              value: tweaks.density,
              options: ["compact", "regular", "spacious"],
              onChange: (v) => setTweak("density", v)
            }
          ),
          /* @__PURE__ */ jsx(
            Segmented,
            {
              label: "Activity",
              value: tweaks.activity,
              options: ["shimmer", "pulse", "none"],
              onChange: (v) => setTweak("activity", v)
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: reset,
              style: {
                marginTop: 8,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-dim)",
                padding: "6px 10px",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "var(--mono)",
                fontSize: 11
              },
              children: "Reset to defaults"
            }
          )
        ] })
      ]
    }
  );
}
function Section({ label }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        fontFamily: "var(--mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-faint)",
        marginTop: 2
      },
      children: label
    }
  );
}
function Segmented({
  label,
  value,
  options,
  onChange
}) {
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    /* @__PURE__ */ jsx(
      "span",
      {
        style: {
          fontFamily: "var(--sans)",
          fontSize: 11.5,
          color: "var(--text-dim)"
        },
        children: label
      }
    ),
    /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          display: "flex",
          padding: 2,
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7
        },
        children: options.map((opt) => /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => onChange(opt),
            style: {
              flex: 1,
              padding: "5px 8px",
              border: 0,
              background: value === opt ? "var(--surface-3)" : "transparent",
              color: value === opt ? "var(--text)" : "var(--text-dim)",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500
            },
            children: opt
          },
          opt
        ))
      }
    )
  ] });
}
function ColorRow({
  label,
  value,
  onChange
}) {
  const swatches = ["#7ce58a", "#8ab4ff", "#c792ea", "#fbbf24", "#f472b6", "#34d399", "#fb923c", "#f87171"];
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        },
        children: [
          /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                fontFamily: "var(--sans)",
                fontSize: 11.5,
                color: "var(--text-dim)"
              },
              children: label
            }
          ),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "color",
              value,
              onChange: (e) => onChange(e.target.value),
              style: {
                width: 36,
                height: 22,
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "transparent",
                cursor: "pointer"
              }
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 4 }, children: swatches.map((c) => /* @__PURE__ */ jsx(
      "button",
      {
        onClick: () => onChange(c),
        title: c,
        style: {
          width: 22,
          height: 22,
          borderRadius: 5,
          background: c,
          border: value.toLowerCase() === c.toLowerCase() ? "2px solid var(--text)" : "2px solid transparent",
          cursor: "pointer",
          padding: 0
        }
      },
      c
    )) })
  ] });
}
const Route$4 = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MissionControl" }
    ]
  }),
  component: RootComponent
});
function RootComponent() {
  return /* @__PURE__ */ jsxs("html", { children: [
    /* @__PURE__ */ jsx("head", { children: /* @__PURE__ */ jsx(HeadContent, {}) }),
    /* @__PURE__ */ jsxs("body", { children: [
      /* @__PURE__ */ jsx(TerminalProvider, { children: /* @__PURE__ */ jsx(Shell, {}) }),
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
function Shell() {
  const router2 = useRouter();
  const { theme, toggle } = useTheme();
  const { open, close, closeAll, setPtyId } = useTerminals();
  const path = router2.state.location.pathname;
  const crumbs = path.startsWith("/projects/") ? [{ label: "Project" }] : path === "/archive" ? [{ label: "Archive" }] : path === "/settings" ? [{ label: "Settings" }] : [];
  const goHome = () => router2.navigate({ to: "/" });
  return /* @__PURE__ */ jsxs("div", { id: "root", children: [
    /* @__PURE__ */ jsx(
      TopBar,
      {
        crumbs,
        onHome: goHome,
        right: /* @__PURE__ */ jsxs(Fragment, { children: [
          path !== "/" && /* @__PURE__ */ jsx(Btn, { variant: "ghost", icon: "home", onClick: goHome, children: "Mission Control" }),
          /* @__PURE__ */ jsx(
            Btn,
            {
              variant: "ghost",
              icon: "settings",
              onClick: () => router2.navigate({ to: "/settings" }),
              children: "Settings"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: toggle,
              title: theme === "dark" ? "Switch to light" : "Switch to dark",
              style: {
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--text-faint)",
                padding: "2px 7px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "transparent",
                cursor: "pointer"
              },
              children: theme === "dark" ? "☼" : "☽"
            }
          )
        ] })
      }
    ),
    /* @__PURE__ */ jsxs("div", { style: { flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }, children: [
      /* @__PURE__ */ jsx("div", { style: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }, children: /* @__PURE__ */ jsx(Outlet, {}) }),
      /* @__PURE__ */ jsx(
        TerminalPanel,
        {
          open,
          onClose: close,
          onCloseAll: closeAll,
          onPtyReady: setPtyId
        }
      )
    ] }),
    /* @__PURE__ */ jsx(TweaksLauncher, {})
  ] });
}
const $$splitComponentImporter$3 = () => import("./settings-dBDH7yvh.js");
const Route$3 = createFileRoute("/settings")({
  component: lazyRouteComponent($$splitComponentImporter$3, "component")
});
const $$splitComponentImporter$2 = () => import("./archive-CPKAZgue.js");
const Route$2 = createFileRoute("/archive")({
  component: lazyRouteComponent($$splitComponentImporter$2, "component")
});
const $$splitComponentImporter$1 = () => import("./index-gfkENsHv.js");
const Route$1 = createFileRoute("/")({
  component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
const $$splitComponentImporter = () => import("./projects._id-Dvalm2mu.js");
const Route = createFileRoute("/projects/$id")({
  component: lazyRouteComponent($$splitComponentImporter, "component")
});
const SettingsRoute = Route$3.update({
  id: "/settings",
  path: "/settings",
  getParentRoute: () => Route$4
});
const ArchiveRoute = Route$2.update({
  id: "/archive",
  path: "/archive",
  getParentRoute: () => Route$4
});
const IndexRoute = Route$1.update({
  id: "/",
  path: "/",
  getParentRoute: () => Route$4
});
const ProjectsIdRoute = Route.update({
  id: "/projects/$id",
  path: "/projects/$id",
  getParentRoute: () => Route$4
});
const rootRouteChildren = {
  IndexRoute,
  ArchiveRoute,
  SettingsRoute,
  ProjectsIdRoute
};
const routeTree = Route$4._addFileChildren(rootRouteChildren)._addFileTypes();
function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent"
  });
}
const router = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getRouter
}, Symbol.toStringTag, { value: "Module" }));
export {
  AGENT_META as A,
  Btn as B,
  Icon as I,
  ProjectIcon as P,
  Route as R,
  ShimmerBar as S,
  api as a,
  StatusPill as b,
  StatusDot as c,
  STATUS_META as d,
  ICON_COLORS as e,
  getElectron as g,
  router as r,
  useTerminals as u
};
