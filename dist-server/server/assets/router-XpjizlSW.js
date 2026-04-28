import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useRouter, createRootRouteWithContext, HeadContent, Scripts, Outlet, createFileRoute, lazyRouteComponent, redirect, createRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { queryOptions, useQuery, useQueryClient, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useCallback, useEffect, useMemo, createContext, useContext, useRef } from "react";
function getElectron() {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}
function isElectron() {
  return getElectron() !== null;
}
const electron = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getElectron,
  isElectron
}, Symbol.toStringTag, { value: "Module" }));
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
    case "github":
      return /* @__PURE__ */ jsx("svg", { ...common, viewBox: "0 0 16 16", fill: "currentColor", stroke: "none", children: /* @__PURE__ */ jsx("path", { d: "M8 .5a7.5 7.5 0 00-2.37 14.62c.37.07.5-.16.5-.36v-1.27c-2.08.45-2.52-1-2.52-1-.34-.87-.83-1.1-.83-1.1-.68-.46.05-.45.05-.45.75.05 1.14.77 1.14.77.67 1.14 1.75.81 2.18.62.07-.48.26-.81.47-1-1.66-.19-3.41-.83-3.41-3.7 0-.82.29-1.49.77-2.01-.08-.19-.33-.95.07-1.99 0 0 .63-.2 2.06.77a7.16 7.16 0 013.75 0c1.43-.97 2.06-.77 2.06-.77.4 1.04.15 1.8.07 1.99.48.52.77 1.19.77 2.01 0 2.88-1.75 3.51-3.42 3.69.27.23.5.68.5 1.37v2.03c0 .2.13.43.5.36A7.5 7.5 0 008 .5z" }) });
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
                  c.node ? c.node : /* @__PURE__ */ jsx(
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
  listUserTerminals: (projectId) => req(`/api/projects/${projectId}/user-terminals`),
  createUserTerminal: (projectId, body) => req(`/api/projects/${projectId}/user-terminals`, {
    method: "POST",
    body: JSON.stringify(body)
  }),
  renameUserTerminal: (id, name) => req(`/api/user-terminals/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name })
  }),
  deleteUserTerminal: (id) => req(`/api/user-terminals/${id}`, { method: "DELETE" }),
  getKeybindings: () => req("/api/keybindings"),
  setKeybinding: (action, binding) => req("/api/keybindings", {
    method: "PUT",
    body: JSON.stringify({ action, binding })
  }),
  resetKeybinding: (action) => req(`/api/keybindings?action=${encodeURIComponent(action)}`, {
    method: "DELETE"
  }),
  resetAllKeybindings: () => req("/api/keybindings", { method: "DELETE" }),
  getSettings: () => req("/api/settings"),
  regenerateToken: () => req("/api/settings", {
    method: "POST",
    body: JSON.stringify({ regenerate: true })
  }),
  getGitStatus: (projectId) => req(`/api/projects/${projectId}/git/status`),
  getGitDiff: (projectId, file, staged) => req(
    `/api/projects/${projectId}/git/diff?file=${encodeURIComponent(file)}&staged=${staged ? "1" : "0"}`
  ),
  stageFiles: (projectId, files) => req(`/api/projects/${projectId}/git/stage`, {
    method: "POST",
    body: JSON.stringify({ files })
  }),
  unstageFiles: (projectId, files) => req(`/api/projects/${projectId}/git/unstage`, {
    method: "POST",
    body: JSON.stringify({ files })
  }),
  gitCommit: (projectId, message) => req(`/api/projects/${projectId}/git/commit`, {
    method: "POST",
    body: JSON.stringify({ message })
  }),
  gitPush: (projectId) => req(`/api/projects/${projectId}/git/push`, { method: "POST" }),
  generateCommitMessage: (projectId) => req(
    `/api/projects/${projectId}/git/generate-commit-message`,
    { method: "POST" }
  )
};
function makeBinding(partial) {
  return { mod: false, shift: false, alt: false, ...partial };
}
const DEFAULT_BINDINGS = {
  "agent.new": makeBinding({ mod: true, key: "n" }),
  "project.edit": makeBinding({ mod: true, key: "e" }),
  "project.picker": makeBinding({ mod: true, key: "u" }),
  "nav.toggle": makeBinding({ mod: true, key: "m" }),
  "search.focus": makeBinding({ mod: true, key: "/" }),
  "terminal.toggle": makeBinding({ mod: true, key: "`" }),
  "terminal.close": makeBinding({ mod: true, key: "l" }),
  "dialog.submit": makeBinding({ mod: true, key: "Enter" }),
  "file.finder": makeBinding({ mod: true, key: "p" }),
  "file.save": makeBinding({ mod: true, key: "s" })
};
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const KEY_GLYPH = {
  Enter: "↵",
  enter: "↵",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Tab: "⇥",
  " ": "Space"
};
function formatKey(key) {
  if (KEY_GLYPH[key]) return KEY_GLYPH[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}
function formatBinding(b) {
  const parts = [];
  if (b.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (b.alt) parts.push(isMac ? "⌥" : "Alt");
  if (b.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(formatKey(b.key));
  return isMac ? parts.join("") : parts.join("+");
}
const KeybindingsContext = createContext(null);
function KeybindingsProvider({ children }) {
  const [bindings, setBindings] = useState(DEFAULT_BINDINGS);
  const refresh = useCallback(async () => {
    try {
      const r = await api.getKeybindings();
      setBindings(r.bindings);
    } catch {
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const value = useMemo(
    () => ({
      bindings,
      refresh,
      async setBinding(action, b) {
        const r = await api.setKeybinding(action, b);
        setBindings(r.bindings);
      },
      async resetBinding(action) {
        const r = await api.resetKeybinding(action);
        setBindings(r.bindings);
      },
      async resetAll() {
        const r = await api.resetAllKeybindings();
        setBindings(r.bindings);
      }
    }),
    [bindings, refresh]
  );
  return /* @__PURE__ */ jsx(KeybindingsContext.Provider, { value, children });
}
function useKeybindings() {
  const ctx = useContext(KeybindingsContext);
  if (!ctx) throw new Error("useKeybindings must be used within KeybindingsProvider");
  return ctx;
}
function useBinding(action) {
  return useKeybindings().bindings[action];
}
function useFormattedBinding(action) {
  return formatBinding(useBinding(action));
}
const BASE = {
  fontFamily: "var(--mono)",
  padding: "1px 5px"
};
const VARIANT_STYLE = {
  onPrimary: {
    marginLeft: 6,
    borderRadius: 4,
    background: "rgba(0,0,0,0.18)",
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: 1.4
  },
  ghost: {
    marginLeft: 6,
    fontSize: 10,
    color: "var(--text-faint)",
    border: "1px solid var(--border)",
    borderRadius: 3,
    background: "var(--surface-1)"
  },
  inline: {
    fontSize: 11,
    border: "1px solid var(--border)",
    borderRadius: 3,
    background: "var(--surface-0)"
  }
};
function Kbd({
  variant = "ghost",
  children,
  style
}) {
  return /* @__PURE__ */ jsx("kbd", { style: { ...BASE, ...VARIANT_STYLE[variant], ...style }, children });
}
function KbdAction({
  action,
  variant = "ghost",
  style
}) {
  const label = useFormattedBinding(action);
  return /* @__PURE__ */ jsx(Kbd, { variant, style, children: label });
}
function normalizeKey(key) {
  if (key.length === 1) return key.toLowerCase();
  return key;
}
function eventToBinding(e) {
  const key = e.key;
  if (key === "Meta" || key === "Control" || key === "Shift" || key === "Alt") return null;
  return {
    mod: e.metaKey || e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: normalizeKey(key)
  };
}
function matchBinding(e, b) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod !== b.mod) return false;
  if (e.shiftKey !== b.shift) return false;
  if (e.altKey !== b.alt) return false;
  const ek = normalizeKey(e.key);
  if (ek === b.key) return true;
  if (b.key === "`" && ek === "~") return true;
  return false;
}
function bindingsEqual(a, b) {
  return a.mod === b.mod && a.shift === b.shift && a.alt === b.alt && normalizeKey(a.key) === normalizeKey(b.key);
}
function bindingComboKey(b) {
  return `${b.mod ? "M" : ""}${b.shift ? "S" : ""}${b.alt ? "A" : ""}|${normalizeKey(b.key)}`;
}
function isValidBinding(b) {
  if (!b.mod) return { ok: false, reason: "Binding must include Cmd/Ctrl." };
  if (!b.key) return { ok: false, reason: "Missing key." };
  if (b.key === "Meta" || b.key === "Control" || b.key === "Shift" || b.key === "Alt") {
    return { ok: false, reason: "Binding must include a non-modifier key." };
  }
  return { ok: true };
}
const HOTKEY_ACTIONS = [
  "agent.new",
  "project.edit",
  "project.picker",
  "nav.toggle",
  "search.focus",
  "terminal.toggle",
  "terminal.close",
  "dialog.submit",
  "file.finder",
  "file.save"
];
const ACTION_META = {
  "agent.new": { label: "New agent / project", description: "Create a new agent on a project page, or a new project on the home page." },
  "project.edit": { label: "Edit project", description: "Open the edit dialog for the current project." },
  "project.picker": { label: "Open project picker", description: "Open the cross-project quick switcher." },
  "nav.toggle": { label: "Toggle nav menu", description: "Show or hide the navigation menu." },
  "search.focus": { label: "Focus search", description: "Focus the project search field on the home page." },
  "terminal.toggle": { label: "Toggle terminal panel", description: "Show or hide the bottom terminal panel." },
  "terminal.close": { label: "Close terminal", description: "Deselect / close the active terminal session." },
  "dialog.submit": { label: "Submit dialog", description: "Submit a dialog form (New agent, edit project, etc.)." },
  "file.finder": { label: "Open file finder", description: "Open the fuzzy file finder for the current project." },
  "file.save": { label: "Save file", description: "Save the file currently open in the editor." }
};
function isAction(t) {
  return HOTKEY_ACTIONS.includes(t);
}
function matchLiteral(e, t) {
  if (t === "enter") {
    const mod = e.metaKey || e.ctrlKey;
    return !mod && !e.shiftKey && !e.altKey && e.key === "Enter";
  }
  return e.key === "Escape";
}
function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
function useHotkey(target, handler, options = {}) {
  const {
    enabled = true,
    ignoreEditable = false,
    preventDefault = true,
    capture = false
  } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const { bindings } = useKeybindings();
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e) => {
      const matched = isAction(target) ? matchBinding(e, bindingsRef.current[target]) : matchLiteral(e, target);
      if (!matched) return;
      if (ignoreEditable && isEditableTarget(e.target)) return;
      if (preventDefault) e.preventDefault();
      if (capture) e.stopPropagation();
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKey, capture);
    return () => window.removeEventListener("keydown", onKey, capture);
  }, [target, enabled, ignoreEditable, preventDefault, capture]);
}
const DISPATCH_COOLDOWN_MS = 400;
const WHEEL_THRESHOLD = 60;
const WHEEL_IDLE_MS = 180;
function useNavigationSwipe() {
  const router2 = useRouter();
  useEffect(() => {
    const dispatch = makeDispatcher(router2);
    const isModalOpen = () => document.querySelector("[data-modal-open]") !== null;
    let wheelSum = 0;
    let wheelIdleTimer = null;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (isModalOpen()) return;
      wheelSum += e.deltaX;
      if (wheelIdleTimer) clearTimeout(wheelIdleTimer);
      wheelIdleTimer = setTimeout(() => {
        wheelSum = 0;
      }, WHEEL_IDLE_MS);
      if (wheelSum <= -WHEEL_THRESHOLD) {
        dispatch("back");
        wheelSum = 0;
      } else if (wheelSum >= WHEEL_THRESHOLD) {
        dispatch("forward");
        wheelSum = 0;
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    const offSwipe = getElectron()?.onSwipe((dir) => {
      if (isModalOpen()) return;
      if (dir === "left") dispatch("back");
      else if (dir === "right") dispatch("forward");
    });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (wheelIdleTimer) clearTimeout(wheelIdleTimer);
      offSwipe?.();
    };
  }, [router2]);
}
function makeDispatcher(router2) {
  let lastAt = 0;
  return (dir) => {
    const now = performance.now();
    if (now - lastAt < DISPATCH_COOLDOWN_MS) return;
    lastAt = now;
    if (dir === "back") router2.history.back();
    else router2.history.forward();
  };
}
const KEY = "mc.theme";
function useTheme() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) ?? "dark";
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } catch {
    }
  }, []);
  const set = (t) => {
    setTheme(t);
    try {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem(KEY, t);
    } catch {
    }
  };
  const toggle = () => set(theme === "dark" ? "light" : "dark");
  return { theme, toggle, set };
}
const AGENT_META = {
  "claude-code": { label: "Claude Code", color: "#d6a56b", glyph: "◆", cmd: "claude" },
  codex: { label: "Codex", color: "#8ab4ff", glyph: "◇", cmd: "codex" },
  "cursor-cli": { label: "Cursor CLI", color: "#c792ea", glyph: "▲", cmd: "cursor-agent" },
  shell: { label: "Shell", color: "#7ce58a", glyph: "❯", cmd: "$SHELL" }
};
const STATUS_META = {
  ready: { label: "Ready", color: "var(--status-ready)", dot: true, shimmer: false },
  running: { label: "Running", color: "var(--status-running)", dot: true, shimmer: true },
  "needs-input": { label: "Needs input", color: "var(--status-needs)", dot: true, shimmer: false },
  finished: { label: "Finished", color: "var(--status-done)", dot: true, shimmer: false },
  terminated: { label: "Terminated", color: "var(--status-idle)", dot: false, shimmer: false }
};
const ICON_COLORS = ["#7ce58a", "#8ab4ff", "#c792ea", "#fbbf24", "#f472b6", "#34d399", "#fb923c"];
const TerminalContext = createContext(null);
function commandFor(agent) {
  if (agent === "shell") return "";
  return AGENT_META[agent].cmd;
}
function TerminalProvider({ children }) {
  const [sessions, setSessions] = useState([]);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const killPty = async (id) => {
    if (!id) return;
    const electron2 = getElectron();
    if (!electron2) return;
    await electron2.pty.kill(id).catch(() => void 0);
  };
  const toggle = useCallback(
    (project, task, opts) => {
      setSessions((prev) => {
        if (prev.some((p) => p.taskId === task.id)) return prev;
        const next = {
          taskId: task.id,
          ptyId: null,
          startCommand: opts?.startCommandOverride ?? commandFor(task.agent),
          cwd: project.path,
          project,
          task
        };
        return [...prev, next];
      });
      setActiveTaskId((curr) => curr === task.id ? null : task.id);
    },
    []
  );
  const deselect = useCallback(() => {
    setActiveTaskId(null);
  }, []);
  const close = useCallback(async (taskId) => {
    setSessions((prev) => {
      const target = prev.find((p) => p.taskId === taskId);
      if (target) void killPty(target.ptyId);
      return prev.filter((p) => p.taskId !== taskId);
    });
    setActiveTaskId((curr) => curr === taskId ? null : curr);
  }, []);
  const closeForProject = useCallback(async (projectId) => {
    setSessions((prev) => {
      const remaining = [];
      for (const t of prev) {
        if (t.project.id === projectId) void killPty(t.ptyId);
        else remaining.push(t);
      }
      return remaining;
    });
    setActiveTaskId((curr) => {
      if (!curr) return curr;
      const stillAlive = sessions.some(
        (s) => s.taskId === curr && s.project.id !== projectId
      );
      return stillAlive ? curr : null;
    });
  }, [sessions]);
  const setPtyId = useCallback((taskId, ptyId) => {
    setSessions((prev) => prev.map((p) => p.taskId === taskId ? { ...p, ptyId } : p));
  }, []);
  const runIn = useCallback(
    async (taskId, command) => {
      const electron2 = getElectron();
      if (!electron2) return;
      const target = sessions.find((p) => p.taskId === taskId);
      if (!target?.ptyId) return;
      await electron2.pty.write(target.ptyId, command + "\r");
    },
    [sessions]
  );
  const active = activeTaskId ? sessions.find((s) => s.taskId === activeTaskId) ?? null : null;
  return /* @__PURE__ */ jsx(
    TerminalContext.Provider,
    {
      value: {
        sessions,
        active,
        activeTaskId,
        toggle,
        deselect,
        close,
        closeForProject,
        setPtyId,
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
const UserTerminalContext = createContext(null);
function UserTerminalProvider({ children }) {
  const [project, setProjectState] = useState(null);
  const [sessionsByProject, setSessionsByProject] = useState({});
  const [focusedByProject, setFocusedByProject] = useState({});
  const [panelOpenByProject, setPanelOpenByProject] = useState({});
  const loadedProjectsRef = useRef(/* @__PURE__ */ new Set());
  const panelOpen = project ? panelOpenByProject[project.id] ?? true : false;
  const setPanelOpen = useCallback(
    (open) => {
      if (!project) return;
      const pid = project.id;
      setPanelOpenByProject((prev) => prev[pid] === open ? prev : { ...prev, [pid]: open });
    },
    [project]
  );
  const togglePanel = useCallback(() => {
    if (!project) return;
    const pid = project.id;
    setPanelOpenByProject((prev) => ({ ...prev, [pid]: !(prev[pid] ?? true) }));
  }, [project]);
  const setProject = useCallback((next) => {
    setProjectState((prev) => prev?.id === next?.id ? prev : next);
  }, []);
  useEffect(() => {
    const id = project?.id;
    if (!id) return;
    if (loadedProjectsRef.current.has(id)) return;
    loadedProjectsRef.current.add(id);
    let cancelled = false;
    void (async () => {
      try {
        const { terminals } = await api.listUserTerminals(id);
        if (cancelled) return;
        setSessionsByProject((prev) => {
          if (prev[id]) return prev;
          return { ...prev, [id]: terminals.map((t) => ({ terminal: t, ptyId: null })) };
        });
        setFocusedByProject((prev) => {
          if (prev[id] !== void 0) return prev;
          return { ...prev, [id]: terminals[0]?.id ?? null };
        });
      } catch {
        loadedProjectsRef.current.delete(id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);
  const sessions = project ? sessionsByProject[project.id] ?? [] : [];
  const focusedId = project ? focusedByProject[project.id] ?? null : null;
  const updateSessions = useCallback(
    (projectId, fn) => {
      setSessionsByProject((prev) => ({ ...prev, [projectId]: fn(prev[projectId] ?? []) }));
    },
    []
  );
  const setFocusFor = useCallback((projectId, id) => {
    setFocusedByProject((prev) => ({ ...prev, [projectId]: id }));
  }, []);
  const createTerminal = useCallback(
    async (opts) => {
      if (!project) return null;
      const projectId = project.id;
      const { terminal } = await api.createUserTerminal(projectId, {
        cwd: project.path,
        name: opts?.name,
        startCommand: opts?.startCommand ?? null
      });
      updateSessions(projectId, (prev) => [...prev, { terminal, ptyId: null }]);
      setFocusFor(projectId, terminal.id);
      setPanelOpen(true);
      return terminal;
    },
    [project, updateSessions, setFocusFor]
  );
  const killTerminal = useCallback(
    async (id) => {
      const electron2 = getElectron();
      let ownerProjectId = null;
      let killedPtyId = null;
      let neighborId = null;
      setSessionsByProject((prev) => {
        const next = { ...prev };
        for (const [pid, list] of Object.entries(prev)) {
          const idx = list.findIndex((s) => s.terminal.id === id);
          if (idx === -1) continue;
          ownerProjectId = pid;
          killedPtyId = list[idx].ptyId;
          const filtered = list.filter((s) => s.terminal.id !== id);
          if (filtered.length > 0) {
            const pick = idx > 0 ? idx - 1 : 0;
            neighborId = filtered[pick].terminal.id;
          }
          next[pid] = filtered;
          break;
        }
        return next;
      });
      if (killedPtyId && electron2) {
        await electron2.pty.kill(killedPtyId).catch(() => void 0);
      }
      if (ownerProjectId) {
        setFocusedByProject((prev) => {
          if (prev[ownerProjectId] !== id) return prev;
          return { ...prev, [ownerProjectId]: neighborId };
        });
      }
      try {
        await api.deleteUserTerminal(id);
      } catch {
      }
    },
    []
  );
  const renameTerminal = useCallback(async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSessionsByProject((prev) => {
      const next = { ...prev };
      for (const [pid, list] of Object.entries(prev)) {
        if (!list.some((s) => s.terminal.id === id)) continue;
        next[pid] = list.map(
          (s) => s.terminal.id === id ? { ...s, terminal: { ...s.terminal, name: trimmed } } : s
        );
      }
      return next;
    });
    try {
      await api.renameUserTerminal(id, trimmed);
    } catch {
    }
  }, []);
  const setPtyId = useCallback((terminalId, ptyId) => {
    setSessionsByProject((prev) => {
      const next = { ...prev };
      for (const [pid, list] of Object.entries(prev)) {
        if (!list.some((s) => s.terminal.id === terminalId)) continue;
        next[pid] = list.map(
          (s) => s.terminal.id === terminalId ? { ...s, ptyId } : s
        );
      }
      return next;
    });
  }, []);
  const killTerminalsByStartCommand = useCallback(
    async (commands) => {
      if (!project) return;
      const list = sessionsByProject[project.id] ?? [];
      const wanted = new Set(commands.map((c) => c.trim()).filter(Boolean));
      const targets = list.filter(
        (s) => s.terminal.startCommand && wanted.has(s.terminal.startCommand.trim())
      );
      await Promise.all(targets.map((s) => killTerminal(s.terminal.id)));
    },
    [project, sessionsByProject, killTerminal]
  );
  const focusTerminal = useCallback(
    (id) => {
      if (!project) return;
      setFocusFor(project.id, id);
    },
    [project, setFocusFor]
  );
  const cycle = useCallback(
    (delta) => {
      if (!project) return;
      const list = sessionsByProject[project.id] ?? [];
      if (list.length === 0) return;
      setPanelOpen(true);
      const cur = focusedByProject[project.id] ?? null;
      const idx = cur ? list.findIndex((s) => s.terminal.id === cur) : -1;
      const nextIdx = idx === -1 ? 0 : (idx + delta + list.length) % list.length;
      setFocusFor(project.id, list[nextIdx].terminal.id);
    },
    [project, sessionsByProject, focusedByProject, setFocusFor]
  );
  const cycleNext = useCallback(() => cycle(1), [cycle]);
  const cyclePrev = useCallback(() => cycle(-1), [cycle]);
  const value = useMemo(
    () => ({
      project,
      setProject,
      panelOpen,
      togglePanel,
      setPanelOpen,
      sessions,
      focusedId,
      focusTerminal,
      createTerminal,
      killTerminal,
      killTerminalsByStartCommand,
      renameTerminal,
      setPtyId,
      cycleNext,
      cyclePrev
    }),
    [
      project,
      setProject,
      panelOpen,
      togglePanel,
      sessions,
      focusedId,
      focusTerminal,
      createTerminal,
      killTerminal,
      killTerminalsByStartCommand,
      renameTerminal,
      setPtyId,
      cycleNext,
      cyclePrev
    ]
  );
  return /* @__PURE__ */ jsx(UserTerminalContext.Provider, { value, children });
}
function useUserTerminals() {
  const ctx = useContext(UserTerminalContext);
  if (!ctx) throw new Error("useUserTerminals must be used inside UserTerminalProvider");
  return ctx;
}
function useResizablePanel(opts) {
  const { storageKey, axis, defaultSize, minSize, maxSize } = opts;
  const [size, setSize] = useState(() => {
    if (typeof window === "undefined") return defaultSize;
    const raw = window.localStorage.getItem(storageKey);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= minSize ? n : defaultSize;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(size));
    } catch {
    }
  }, [storageKey, size]);
  const dragRef = useRef(null);
  const onMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      const startCoord = axis === "x" ? e.clientX : e.clientY;
      dragRef.current = { start: startCoord, startSize: size };
      const onMove = (ev) => {
        if (!dragRef.current) return;
        const cur = axis === "x" ? ev.clientX : ev.clientY;
        const delta = dragRef.current.start - cur;
        const viewport = axis === "x" ? window.innerWidth : window.innerHeight;
        const upperBound = maxSize ? maxSize(viewport) : viewport - minSize;
        const next = Math.max(minSize, Math.min(upperBound, dragRef.current.startSize + delta));
        setSize(next);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis, size, minSize, maxSize]
  );
  return { size, onMouseDown };
}
function ProjectIcon({ project, size = 36 }) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [project.imagePath, project.updatedAt]);
  if (project.imagePath && !imgFailed) {
    const v = project.updatedAt ?? 0;
    return /* @__PURE__ */ jsx(
      "img",
      {
        src: `app://project-image/${project.imagePath}?v=${v}`,
        alt: "",
        onError: () => setImgFailed(true),
        style: {
          width: size,
          height: size,
          borderRadius: size * 0.22,
          objectFit: "cover",
          border: `1px solid ${project.iconColor}33`,
          flexShrink: 0
        }
      }
    );
  }
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
function mapTerminalKey(e) {
  if (e.type !== "keydown") return null;
  if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return "\x1B\r";
  }
  if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "ArrowLeft") return "";
    if (e.key === "ArrowRight") return "";
    if (e.key === "Backspace") return "";
  }
  if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    if (e.key === "ArrowLeft") return "\x1Bb";
    if (e.key === "ArrowRight") return "\x1Bf";
  }
  return null;
}
const queryKeys = {
  projects: ["projects"],
  project: (id) => ["projects", id],
  groups: ["groups"],
  tasks: (projectId) => ["projects", projectId, "tasks"],
  archive: ["archive"],
  settings: ["settings"],
  keybindings: ["keybindings"],
  userTerminals: (projectId) => ["projects", projectId, "user-terminals"]
};
const projectsQueryOptions = () => queryOptions({
  queryKey: queryKeys.projects,
  queryFn: async () => (await api.listProjects()).projects
});
const projectQueryOptions = (id) => queryOptions({
  queryKey: queryKeys.project(id),
  queryFn: async () => (await api.getProject(id)).project
});
const groupsQueryOptions = () => queryOptions({
  queryKey: queryKeys.groups,
  queryFn: async () => (await api.listGroups()).groups
});
const tasksQueryOptions = (projectId) => queryOptions({
  queryKey: queryKeys.tasks(projectId),
  queryFn: async () => (await api.listTasks(projectId)).tasks
});
const archiveQueryOptions = () => queryOptions({
  queryKey: queryKeys.archive,
  queryFn: async () => (await api.listArchive()).tasks
});
const settingsQueryOptions = () => queryOptions({
  queryKey: queryKeys.settings,
  queryFn: async () => api.getSettings()
});
const useProjects = () => useQuery(projectsQueryOptions());
const useProject = (id) => useQuery(projectQueryOptions(id));
const useGroups = () => useQuery(groupsQueryOptions());
const useTasks = (projectId) => useQuery(tasksQueryOptions(projectId));
const useArchive = () => useQuery(archiveQueryOptions());
const useSettings = () => useQuery(settingsQueryOptions());
async function resolveMcEnv(electron2, queryClient) {
  try {
    const [port, settings] = await Promise.all([
      electron2.getRuntimePort(),
      queryClient.ensureQueryData(settingsQueryOptions())
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
  const fitRef = useRef(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const queryClient = useQueryClient();
  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";
  useEffect(() => {
    const electron2 = getElectron();
    if (!electron2) {
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
      fitRef.current = fit;
      term.loadAddon(fit);
      term.open(containerRef.current);
      term.focus();
      const host = containerRef.current;
      const subscriptions = [];
      let rafHandle = 0;
      let activePtyId = null;
      const onDragOver = (e) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      };
      const onDrop = (e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        if (!activePtyId) return;
        const paths = files.map((f) => electron2.getPathForFile(f)).filter(Boolean).map((p) => /[\s"'\\]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);
        if (!paths.length) return;
        electron2.pty.write(activePtyId, paths.join(" ") + " ");
        term.focus();
      };
      host.addEventListener("dragover", onDragOver);
      host.addEventListener("drop", onDrop);
      term.attachCustomKeyEventHandler((e) => {
        const bytes = mapTerminalKey(e);
        if (bytes === null) return true;
        if (activePtyId) electron2.pty.write(activePtyId, bytes);
        return false;
      });
      const wireToPty = (ptyId) => {
        activePtyId = ptyId;
        subscriptions.push(
          electron2.pty.onData((msg) => {
            if (msg.ptyId === ptyId) term.write(msg.data);
          }),
          electron2.pty.onExit((msg) => {
            if (msg.ptyId === ptyId) {
              term.writeln("");
              term.writeln(`\x1B[2m[process exited (code=${msg.exitCode})]\x1B[0m`);
              void (async () => {
                try {
                  const settings = await queryClient.ensureQueryData(
                    settingsQueryOptions()
                  );
                  await api.updateTaskStatus(
                    descriptor.taskId,
                    { status: "terminated" },
                    settings.apiToken
                  );
                } catch {
                }
              })();
            }
          })
        );
        term.onData((data) => {
          electron2.pty.write(ptyId, data);
        });
        term.onResize(({ cols, rows }) => {
          electron2.pty.resize(ptyId, cols, rows);
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
            const buf = await electron2.pty.replay(descriptor.ptyId);
            if (!cancelled && buf) term.write(buf);
            return;
          }
          const mcEnv = await resolveMcEnv(electron2, queryClient);
          const { ptyId } = await electron2.pty.spawn({
            taskId: descriptor.taskId,
            cwd: descriptor.cwd,
            command: descriptor.startCommand,
            cols: term.cols,
            rows: term.rows,
            agent: task.agent,
            mcEnv
          });
          if (cancelled) {
            await electron2.pty.kill(ptyId).catch(() => void 0);
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
        host.removeEventListener("dragover", onDragOver);
        host.removeEventListener("drop", onDrop);
        ro.disconnect();
        fitRef.current = null;
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
              flexShrink: 0,
              userSelect: "none"
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
                  onClick: (e) => {
                    e.stopPropagation();
                    onClose();
                  },
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
        /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              flex: 1,
              position: "relative",
              background: "#050607"
            },
            children: bridgeMissing ? /* @__PURE__ */ jsxs(
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
            ) : /* @__PURE__ */ jsx("div", { ref: containerRef, style: { position: "absolute", inset: 0 } })
          }
        )
      ]
    }
  );
}
const MIN_WIDTH = 380;
function TerminalPanel({
  active,
  onClose,
  onPtyReady
}) {
  const { size: width, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: "mc:agentsPanelWidth",
    axis: "x",
    defaultSize: 560,
    minSize: MIN_WIDTH,
    maxSize: (vw) => vw - 320
  });
  if (!active) return null;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        width,
        minWidth: MIN_WIDTH,
        background: "#050607",
        borderLeft: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        animation: "slide-right 0.2s ease-out",
        position: "relative"
      },
      children: [
        /* @__PURE__ */ jsx(
          "div",
          {
            onMouseDown: onResizeMouseDown,
            title: "Drag to resize",
            style: {
              position: "absolute",
              left: -3,
              top: 0,
              bottom: 0,
              width: 6,
              cursor: "col-resize",
              zIndex: 10
            }
          }
        ),
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              background: "var(--surface-0)",
              flexShrink: 0
            },
            children: [
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
                  children: "Agent"
                }
              ),
              /* @__PURE__ */ jsxs("span", { style: { marginLeft: "auto", color: "var(--text-faint)", fontSize: 10.5 }, children: [
                "Close ",
                /* @__PURE__ */ jsx(KbdAction, { action: "terminal.close", variant: "ghost" })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsx("div", { style: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }, children: /* @__PURE__ */ jsx(
          TerminalPane,
          {
            project: active.project,
            task: active.task,
            descriptor: active,
            isLast: true,
            onClose: () => onClose(active.taskId),
            onPtyReady: (ptyId) => onPtyReady(active.taskId, ptyId)
          },
          active.taskId
        ) })
      ]
    }
  );
}
function UserTerminalPane({
  terminal,
  ptyId,
  cwd,
  focused,
  onFocus,
  onPtyReady,
  onKill,
  onRename,
  isLast
}) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(terminal.name);
  useEffect(() => setDraftName(terminal.name), [terminal.name]);
  useEffect(() => {
    const electron2 = getElectron();
    if (!electron2) {
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
          cursor: "#7ce58a",
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
      termRef.current = { focus: () => term.focus() };
      term.focus();
      const onFocusIn = () => onFocus();
      const focusEl = containerRef.current;
      focusEl.addEventListener("focusin", onFocusIn);
      const onDragOver = (e) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      };
      const onDrop = (e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        if (!activePtyId) return;
        const paths = files.map((f) => electron2.getPathForFile(f)).filter(Boolean).map((p) => /[\s"'\\]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);
        if (!paths.length) return;
        electron2.pty.write(activePtyId, paths.join(" ") + " ");
        term.focus();
      };
      focusEl.addEventListener("dragover", onDragOver);
      focusEl.addEventListener("drop", onDrop);
      const subscriptions = [];
      let rafHandle = 0;
      let activePtyId = null;
      term.attachCustomKeyEventHandler((e) => {
        const bytes = mapTerminalKey(e);
        if (bytes === null) return true;
        if (activePtyId) electron2.pty.write(activePtyId, bytes);
        return false;
      });
      const wireToPty = (id) => {
        activePtyId = id;
        subscriptions.push(
          electron2.pty.onData((msg) => {
            if (msg.ptyId === id) term.write(msg.data);
          }),
          electron2.pty.onExit((msg) => {
            if (msg.ptyId === id) {
              term.writeln("");
              term.writeln(`\x1B[2m[process exited (code=${msg.exitCode})]\x1B[0m`);
            }
          })
        );
        term.onData((data) => {
          electron2.pty.write(id, data);
        });
        term.onResize(({ cols, rows }) => {
          electron2.pty.resize(id, cols, rows);
        });
      };
      const ensurePty = async () => {
        if (cancelled) return;
        try {
          try {
            fit.fit();
          } catch {
          }
          if (ptyId) {
            wireToPty(ptyId);
            const buf = await electron2.pty.replay(ptyId);
            if (!cancelled && buf) term.write(buf);
            return;
          }
          const { ptyId: newId } = await electron2.pty.spawn({
            taskId: terminal.id,
            cwd,
            command: terminal.startCommand ?? "",
            cols: term.cols,
            rows: term.rows
          });
          if (cancelled) {
            await electron2.pty.kill(newId).catch(() => void 0);
            return;
          }
          onPtyReady(newId);
          wireToPty(newId);
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
        focusEl.removeEventListener("focusin", onFocusIn);
        focusEl.removeEventListener("dragover", onDragOver);
        focusEl.removeEventListener("drop", onDrop);
        for (const off of subscriptions) off();
        ro.disconnect();
        term.dispose();
        termRef.current = null;
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [terminal.id]);
  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);
  const commitRename = () => {
    setEditing(false);
    if (draftName.trim() && draftName.trim() !== terminal.name) {
      onRename(draftName);
    } else {
      setDraftName(terminal.name);
    }
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      onMouseDown: onFocus,
      style: {
        flex: 1,
        minWidth: 200,
        display: "flex",
        flexDirection: "column",
        borderRight: isLast ? "none" : "1px solid var(--border)",
        overflow: "hidden",
        outline: focused ? "1px solid var(--accent)" : "none",
        outlineOffset: -1
      },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "var(--surface-1)",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0
            },
            children: [
              /* @__PURE__ */ jsx(Icon, { name: "terminal", size: 11, style: { color: "var(--text-faint)" } }),
              editing ? /* @__PURE__ */ jsx(
                "input",
                {
                  autoFocus: true,
                  value: draftName,
                  onChange: (e) => setDraftName(e.target.value),
                  onBlur: commitRename,
                  onKeyDown: (e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") {
                      setEditing(false);
                      setDraftName(terminal.name);
                    }
                  },
                  style: {
                    flex: 1,
                    background: "var(--surface-0)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text)",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    padding: "1px 5px",
                    borderRadius: 3,
                    outline: "none"
                  }
                }
              ) : /* @__PURE__ */ jsx(
                "span",
                {
                  onDoubleClick: () => setEditing(true),
                  title: "Double-click to rename",
                  style: {
                    flex: 1,
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: "text"
                  },
                  children: terminal.name
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: onKill,
                  title: "Kill terminal",
                  style: {
                    background: "transparent",
                    border: 0,
                    padding: 4,
                    color: "var(--text-faint)",
                    cursor: "pointer",
                    display: "flex"
                  },
                  children: /* @__PURE__ */ jsx(Icon, { name: "x", size: 11 })
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsx("div", { style: { flex: 1, position: "relative", background: "#050607" }, children: bridgeMissing ? /* @__PURE__ */ jsx("div", { style: { padding: 16, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }, children: "Terminals require the Electron runtime." }) : /* @__PURE__ */ jsx("div", { ref: containerRef, style: { position: "absolute", inset: 0 } }) })
      ]
    }
  );
}
const MIN_HEIGHT = 160;
function UserTerminalPanel() {
  const {
    project,
    panelOpen,
    setPanelOpen,
    sessions,
    focusedId,
    focusTerminal,
    createTerminal,
    killTerminal,
    renameTerminal,
    setPtyId
  } = useUserTerminals();
  const { size: height, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: "mc:userTerminalsPanelHeight",
    axis: "y",
    defaultSize: 320,
    minSize: MIN_HEIGHT,
    maxSize: (vh) => vh - 160
  });
  if (!project) return null;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        height: panelOpen ? height : "auto",
        minHeight: panelOpen ? MIN_HEIGHT : 0,
        background: "#050607",
        borderTop: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "relative"
      },
      children: [
        panelOpen && /* @__PURE__ */ jsx(
          "div",
          {
            onMouseDown: onResizeMouseDown,
            title: "Drag to resize",
            style: {
              position: "absolute",
              left: 0,
              right: 0,
              top: -3,
              height: 6,
              cursor: "row-resize",
              zIndex: 10
            }
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            onClick: () => setPanelOpen(!panelOpen),
            title: panelOpen ? "Collapse panel" : "Expand panel",
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 14px",
              borderBottom: panelOpen ? "1px solid var(--border)" : "none",
              background: "var(--surface-0)",
              flexShrink: 0,
              width: "100%",
              textAlign: "left",
              border: 0,
              cursor: "pointer",
              color: "inherit"
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
                    children: "Project Terminals"
                  }
                ),
                /* @__PURE__ */ jsx("span", { style: { fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }, children: sessions.length }),
                project && /* @__PURE__ */ jsxs("span", { style: { fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }, children: [
                  "· ",
                  project.name
                ] }),
                /* @__PURE__ */ jsx(Kbd, { variant: "ghost", children: "⌃`" })
              ] }),
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                /* @__PURE__ */ jsxs(
                  "span",
                  {
                    role: "button",
                    tabIndex: 0,
                    onClick: (e) => {
                      e.stopPropagation();
                      if (project) void createTerminal();
                    },
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        if (project) void createTerminal();
                      }
                    },
                    "aria-disabled": !project,
                    title: project ? "New terminal (⌘T)" : "Open a project first",
                    style: {
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: project ? "var(--text-dim)" : "var(--text-faint)",
                      padding: "3px 8px",
                      borderRadius: 5,
                      cursor: project ? "pointer" : "not-allowed",
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5
                    },
                    children: [
                      /* @__PURE__ */ jsx(Icon, { name: "plus", size: 10 }),
                      " New",
                      /* @__PURE__ */ jsx("span", { style: { color: "var(--text-faint)", marginLeft: 4 }, children: "⌘T" })
                    ]
                  }
                ),
                /* @__PURE__ */ jsx(
                  Icon,
                  {
                    name: "chevron-down",
                    size: 12,
                    style: {
                      color: "var(--text-dim)",
                      transform: panelOpen ? "rotate(0deg)" : "rotate(180deg)",
                      transition: "transform 0.15s"
                    }
                  }
                )
              ] })
            ]
          }
        ),
        panelOpen && /* @__PURE__ */ jsx("div", { style: { flex: 1, display: "flex", flexDirection: "row", overflow: "hidden" }, children: sessions.length === 0 ? /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 12
            },
            children: project ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("div", { children: "No terminals yet." }),
              /* @__PURE__ */ jsxs(
                Btn,
                {
                  variant: "ghost",
                  size: "sm",
                  icon: "plus",
                  onClick: () => void createTerminal(),
                  title: "New terminal (⌘T)",
                  children: [
                    "New terminal",
                    /* @__PURE__ */ jsx(Kbd, { variant: "ghost", children: "⌘T" })
                  ]
                }
              )
            ] }) : "Open a project to use terminals."
          }
        ) : sessions.map((s, i) => /* @__PURE__ */ jsx(
          UserTerminalPane,
          {
            terminal: s.terminal,
            ptyId: s.ptyId,
            cwd: s.terminal.cwd || project?.path || "",
            focused: focusedId === s.terminal.id,
            onFocus: () => focusTerminal(s.terminal.id),
            onPtyReady: (ptyId) => setPtyId(s.terminal.id, ptyId),
            onKill: () => void killTerminal(s.terminal.id),
            onRename: (name) => void renameTerminal(s.terminal.id, name),
            isLast: i === sessions.length - 1
          },
          s.terminal.id
        )) })
      ]
    }
  );
}
function useServerEvents(onEvent) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    let es = null;
    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/events");
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          onEvent(data);
        } catch {
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!stopped) setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [onEvent]);
}
function ProjectPicker({ projectId }) {
  const router2 = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: projects } = useProjects();
  const { data: groups = [] } = useGroups();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const itemRefs = useRef([]);
  const current = projects?.find((p) => p.id === projectId) ?? null;
  const label = current?.name ?? "Project";
  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);
  const sections = useMemo(() => {
    const out = [];
    const pinned = filtered.filter((p) => p.pinned);
    if (pinned.length) out.push({ key: "__pinned", label: "Pinned", color: null, projects: pinned });
    const validGroupIds = new Set(groups.map((g) => g.id));
    for (const g of groups) {
      const ps = filtered.filter((p) => !p.pinned && p.groupId === g.id);
      if (ps.length) out.push({ key: g.id, label: g.name, color: g.color, projects: ps });
    }
    const ungrouped = filtered.filter((p) => !p.pinned && (!p.groupId || !validGroupIds.has(p.groupId)));
    if (ungrouped.length) {
      out.push({ key: "__ungrouped", label: out.length ? "Ungrouped" : null, color: null, projects: ungrouped });
    }
    return out;
  }, [filtered, groups]);
  const flatItems = useMemo(() => sections.flatMap((s) => s.projects), [sections]);
  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("project:")) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
        }
        if (e.type.startsWith("group:")) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        }
      },
      [queryClient]
    )
  );
  const select = (id) => {
    setOpen(false);
    setQuery("");
    if (id !== projectId) router2.navigate({ to: "/projects/$id", params: { id } });
  };
  useHotkey(
    "project.picker",
    (e) => {
      if (isEditableTarget(e.target) && !wrapRef.current?.contains(e.target)) return;
      e.preventDefault();
      setOpen((o) => !o);
    },
    { preventDefault: false }
  );
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (highlight >= flatItems.length) setHighlight(0);
  }, [flatItems, highlight]);
  useEffect(() => {
    if (!open) return;
    itemRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);
  const onInputKeyDown = (e) => {
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
  return /* @__PURE__ */ jsxs("div", { ref: wrapRef, style: { position: "relative", display: "inline-flex" }, children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        onClick: () => setOpen((o) => !o),
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--text)",
          background: open ? "var(--surface-1)" : "transparent",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "3px 8px",
          cursor: "pointer"
        },
        title: "Switch project (⌘P)",
        children: [
          current && /* @__PURE__ */ jsx(ProjectIcon, { project: current, size: 14 }),
          /* @__PURE__ */ jsx("span", { children: label }),
          /* @__PURE__ */ jsx(Icon, { name: "chevron-down", size: 11, style: { color: "var(--text-faint)" } }),
          /* @__PURE__ */ jsx(KbdAction, { action: "project.picker", variant: "ghost", style: { marginLeft: 2 } })
        ]
      }
    ),
    open && /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          minWidth: 320,
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        },
        children: [
          /* @__PURE__ */ jsx("div", { style: { padding: 6, borderBottom: "1px solid var(--border)" }, children: /* @__PURE__ */ jsx(
            "input",
            {
              ref: inputRef,
              value: query,
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: onInputKeyDown,
              placeholder: "Search projects…",
              style: {
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--text)",
                padding: "4px 6px"
              }
            }
          ) }),
          /* @__PURE__ */ jsx("div", { style: { maxHeight: 320, overflowY: "auto", padding: 4 }, children: !projects ? /* @__PURE__ */ jsx("div", { style: { padding: 10, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-faint)" }, children: "Loading…" }) : flatItems.length === 0 ? /* @__PURE__ */ jsx("div", { style: { padding: 10, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-faint)" }, children: "No matches." }) : (() => {
            let idx = 0;
            return sections.map((section) => /* @__PURE__ */ jsxs("div", { children: [
              section.label && /* @__PURE__ */ jsxs(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 8px 2px",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "var(--text-faint)"
                  },
                  children: [
                    section.color && /* @__PURE__ */ jsx(
                      "span",
                      {
                        style: {
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: section.color,
                          flexShrink: 0
                        }
                      }
                    ),
                    /* @__PURE__ */ jsx("span", { children: section.label })
                  ]
                }
              ),
              section.projects.map((p) => {
                const i = idx++;
                const active = p.id === projectId;
                const highlighted = i === highlight;
                return /* @__PURE__ */ jsxs(
                  "button",
                  {
                    ref: (el) => {
                      itemRefs.current[i] = el;
                    },
                    onClick: () => select(p.id),
                    onMouseMove: () => setHighlight(i),
                    style: {
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      background: highlighted ? "var(--surface-2, var(--surface-1))" : active ? "var(--surface-1)" : "transparent",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: "var(--text)",
                      outline: highlighted ? "1px solid var(--border)" : "none"
                    },
                    children: [
                      /* @__PURE__ */ jsx(ProjectIcon, { project: p, size: 18 }),
                      /* @__PURE__ */ jsx("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: p.name }),
                      active && /* @__PURE__ */ jsx(Icon, { name: "check", size: 12, style: { color: "var(--text-faint)" } })
                    ]
                  },
                  p.id
                );
              })
            ] }, section.key));
          })() })
        ]
      }
    )
  ] });
}
const Route$8 = createRootRouteWithContext()({
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
      /* @__PURE__ */ jsx(KeybindingsProvider, { children: /* @__PURE__ */ jsx(TerminalProvider, { children: /* @__PURE__ */ jsx(UserTerminalProvider, { children: /* @__PURE__ */ jsx(Shell, {}) }) }) }),
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
function Shell() {
  const router2 = useRouter();
  const { theme, toggle } = useTheme();
  const { active, close, setPtyId } = useTerminals();
  const userTerminals = useUserTerminals();
  useNavigationSwipe();
  const path = router2.state.location.pathname;
  const projectMatch = path.match(/^\/projects\/([^/]+)/);
  const crumbs = projectMatch ? [{ label: "Project", node: /* @__PURE__ */ jsx(ProjectPicker, { projectId: projectMatch[1] }) }] : path === "/archive" ? [{ label: "Archive" }] : path.startsWith("/settings") ? [{ label: "Settings" }] : [{ label: "Project", node: /* @__PURE__ */ jsx(ProjectPicker, {}) }];
  const goHome = () => router2.navigate({ to: "/" });
  useHotkey("terminal.toggle", () => userTerminals.togglePanel());
  useHotkey("nav.toggle", () => router2.navigate({ to: "/" }));
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if ((e.key === "t" || e.key === "T") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void userTerminals.createTerminal();
        return;
      }
      if (e.key === "[" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        userTerminals.cyclePrev();
        return;
      }
      if (e.key === "]" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        userTerminals.cycleNext();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [userTerminals]);
  useEffect(() => {
    const electron2 = getElectron();
    if (!electron2) return;
    return electron2.onCloseIntent(() => {
      if (userTerminals.panelOpen && userTerminals.focusedId) {
        void userTerminals.killTerminal(userTerminals.focusedId);
      }
    });
  }, [userTerminals]);
  return /* @__PURE__ */ jsxs("div", { id: "root", children: [
    /* @__PURE__ */ jsx(
      TopBar,
      {
        crumbs,
        onHome: goHome,
        right: /* @__PURE__ */ jsxs(Fragment, { children: [
          path !== "/" && /* @__PURE__ */ jsxs(Btn, { variant: "ghost", icon: "home", onClick: goHome, children: [
            "Mission Control",
            /* @__PURE__ */ jsx(KbdAction, { action: "nav.toggle" })
          ] }),
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
    /* @__PURE__ */ jsxs("div", { style: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }, children: [
      /* @__PURE__ */ jsxs("div", { style: { flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }, children: [
        /* @__PURE__ */ jsx("div", { style: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }, children: /* @__PURE__ */ jsx(Outlet, {}) }),
        projectMatch && /* @__PURE__ */ jsx(
          TerminalPanel,
          {
            active: active && active.project.id === projectMatch[1] ? active : null,
            onClose: close,
            onPtyReady: setPtyId
          }
        )
      ] }),
      /* @__PURE__ */ jsx(UserTerminalPanel, {})
    ] })
  ] });
}
const $$splitComponentImporter$6 = () => import("./settings-Bw16gIUz.js");
const Route$7 = createFileRoute("/settings")({
  component: lazyRouteComponent($$splitComponentImporter$6, "component")
});
const $$splitComponentImporter$5 = () => import("./archive-Dw6-VJl_.js");
const Route$6 = createFileRoute("/archive")({
  loader: ({
    context
  }) => Promise.all([context.queryClient.ensureQueryData(archiveQueryOptions()), context.queryClient.ensureQueryData(projectsQueryOptions())]),
  component: lazyRouteComponent($$splitComponentImporter$5, "component")
});
const $$splitComponentImporter$4 = () => import("./index-ChgZWGOP.js");
const Route$5 = createFileRoute("/")({
  loader: ({
    context
  }) => Promise.all([context.queryClient.ensureQueryData(projectsQueryOptions()), context.queryClient.ensureQueryData(groupsQueryOptions())]),
  component: lazyRouteComponent($$splitComponentImporter$4, "component")
});
const Route$4 = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/api" });
  }
});
const $$splitComponentImporter$3 = () => import("./settings.storage-DD4YPtjQ.js");
const Route$3 = createFileRoute("/settings/storage")({
  component: lazyRouteComponent($$splitComponentImporter$3, "component")
});
const $$splitComponentImporter$2 = () => import("./settings.keybindings-B8VhVoab.js");
const Route$2 = createFileRoute("/settings/keybindings")({
  component: lazyRouteComponent($$splitComponentImporter$2, "component")
});
const $$splitComponentImporter$1 = () => import("./settings.api-0-lUmHaO.js");
const Route$1 = createFileRoute("/settings/api")({
  loader: ({
    context
  }) => context.queryClient.ensureQueryData(settingsQueryOptions()),
  component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
const $$splitComponentImporter = () => import("./projects._id-Bo4rzfsE.js");
const Route = createFileRoute("/projects/$id")({
  loader: ({
    context,
    params
  }) => Promise.all([context.queryClient.ensureQueryData(projectQueryOptions(params.id)), context.queryClient.ensureQueryData(tasksQueryOptions(params.id)), context.queryClient.ensureQueryData(groupsQueryOptions()), context.queryClient.ensureQueryData(settingsQueryOptions())]),
  component: lazyRouteComponent($$splitComponentImporter, "component")
});
const SettingsRoute = Route$7.update({
  id: "/settings",
  path: "/settings",
  getParentRoute: () => Route$8
});
const ArchiveRoute = Route$6.update({
  id: "/archive",
  path: "/archive",
  getParentRoute: () => Route$8
});
const IndexRoute = Route$5.update({
  id: "/",
  path: "/",
  getParentRoute: () => Route$8
});
const SettingsIndexRoute = Route$4.update({
  id: "/",
  path: "/",
  getParentRoute: () => SettingsRoute
});
const SettingsStorageRoute = Route$3.update({
  id: "/storage",
  path: "/storage",
  getParentRoute: () => SettingsRoute
});
const SettingsKeybindingsRoute = Route$2.update({
  id: "/keybindings",
  path: "/keybindings",
  getParentRoute: () => SettingsRoute
});
const SettingsApiRoute = Route$1.update({
  id: "/api",
  path: "/api",
  getParentRoute: () => SettingsRoute
});
const ProjectsIdRoute = Route.update({
  id: "/projects/$id",
  path: "/projects/$id",
  getParentRoute: () => Route$8
});
const SettingsRouteChildren = {
  SettingsApiRoute,
  SettingsKeybindingsRoute,
  SettingsStorageRoute,
  SettingsIndexRoute
};
const SettingsRouteWithChildren = SettingsRoute._addFileChildren(
  SettingsRouteChildren
);
const rootRouteChildren = {
  IndexRoute,
  ArchiveRoute,
  SettingsRoute: SettingsRouteWithChildren,
  ProjectsIdRoute
};
const routeTree = Route$8._addFileChildren(rootRouteChildren)._addFileTypes();
function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 3e4,
        gcTime: 5 * 6e4,
        refetchOnWindowFocus: false
      }
    }
  });
  const router2 = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    context: { queryClient },
    Wrap: ({ children }) => /* @__PURE__ */ jsx(QueryClientProvider, { client: queryClient, children })
  });
  return routerWithQueryClient(router2, queryClient);
}
const router = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getRouter
}, Symbol.toStringTag, { value: "Module" }));
export {
  ACTION_META as A,
  Btn as B,
  ICON_COLORS as C,
  DEFAULT_BINDINGS as D,
  electron as E,
  router as F,
  HOTKEY_ACTIONS as H,
  Icon as I,
  KbdAction as K,
  ProjectIcon as P,
  Route as R,
  ShimmerBar as S,
  useProjects as a,
  useServerEvents as b,
  api as c,
  StatusPill as d,
  StatusDot as e,
  useGroups as f,
  getElectron as g,
  useUserTerminals as h,
  useHotkey as i,
  useKeybindings as j,
  bindingComboKey as k,
  bindingsEqual as l,
  formatBinding as m,
  Kbd as n,
  eventToBinding as o,
  isValidBinding as p,
  queryKeys as q,
  useSettings as r,
  AGENT_META as s,
  STATUS_META as t,
  useArchive as u,
  isEditableTarget as v,
  useProject as w,
  useTasks as x,
  useFormattedBinding as y,
  useTerminals as z
};
