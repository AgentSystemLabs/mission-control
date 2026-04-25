import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useCallback, useEffect } from "react";
import { a as api, B as Btn, g as getElectron, I as Icon } from "./router-YiALtSFa.js";
import "@tanstack/react-router";
function SettingsPage() {
  const [token, setToken] = useState(null);
  const [port, setPort] = useState(null);
  const [userData, setUserData] = useState(null);
  const [copied, setCopied] = useState(null);
  const load = useCallback(async () => {
    const s = await api.getSettings();
    setToken(s.apiToken);
    const electron = getElectron();
    if (electron) {
      setPort(await electron.getRuntimePort());
      setUserData(await electron.getUserDataDir());
    } else {
      setPort(Number(window.location.port) || null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  const regenerate = async () => {
    const r = await api.regenerateToken();
    setToken(r.apiToken);
  };
  const baseUrl = `http://127.0.0.1:${port ?? "PORT"}`;
  return /* @__PURE__ */ jsx("div", { style: {
    flex: 1,
    overflow: "auto",
    padding: "28px 32px 80px"
  }, className: "dot-grid-bg", children: /* @__PURE__ */ jsxs("div", { style: {
    maxWidth: 720,
    margin: "0 auto"
  }, children: [
    /* @__PURE__ */ jsx("h1", { style: {
      margin: "0 0 24px",
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: "-0.015em"
    }, children: "Settings" }),
    /* @__PURE__ */ jsxs(SettingsSection, { title: "External API", subtitle: "External CLIs (Claude Code / Codex / Cursor CLI) post status updates here.", children: [
      /* @__PURE__ */ jsx(Field, { label: "Endpoint", children: /* @__PURE__ */ jsx(CodeBlock, { value: baseUrl, onCopy: () => copy(baseUrl, "endpoint"), copied: copied === "endpoint" }) }),
      /* @__PURE__ */ jsxs(Field, { label: "API Token", children: [
        /* @__PURE__ */ jsx(CodeBlock, { value: token ?? "loading…", onCopy: () => token && copy(token, "token"), copied: copied === "token", monoSize: 11 }),
        /* @__PURE__ */ jsx("div", { style: {
          marginTop: 8,
          display: "flex",
          gap: 8
        }, children: /* @__PURE__ */ jsx(Btn, { variant: "ghost", icon: "refresh", onClick: regenerate, size: "sm", children: "Regenerate token" }) })
      ] }),
      /* @__PURE__ */ jsx(Field, { label: "Example: mark a task done", children: /* @__PURE__ */ jsx(CodeBlock, { value: `curl -H "Authorization: Bearer $TOKEN" \\
  -X POST ${baseUrl}/api/tasks/$TASK_ID/status \\
  -d '{"status":"done","preview":"All tests passing"}'`, onCopy: () => token && copy(`curl -H "Authorization: Bearer ${token}" -X POST ${baseUrl}/api/tasks/$TASK_ID/status -d '{"status":"done","preview":"All tests passing"}'`, "curl"), copied: copied === "curl", monoSize: 11 }) })
    ] }),
    userData && /* @__PURE__ */ jsx(SettingsSection, { title: "Storage", children: /* @__PURE__ */ jsx(Field, { label: "Data directory", children: /* @__PURE__ */ jsx(CodeBlock, { value: userData, onCopy: () => copy(userData, "data"), copied: copied === "data" }) }) })
  ] }) });
}
function SettingsSection({
  title,
  subtitle,
  children
}) {
  return /* @__PURE__ */ jsxs("div", { style: {
    marginBottom: 24,
    padding: 20,
    background: "var(--surface-1)",
    border: "1px solid var(--border)",
    borderRadius: 12
  }, children: [
    /* @__PURE__ */ jsxs("div", { style: {
      marginBottom: 16
    }, children: [
      /* @__PURE__ */ jsx("div", { style: {
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text)",
        marginBottom: 4
      }, children: title }),
      subtitle && /* @__PURE__ */ jsx("div", { style: {
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        color: "var(--text-dim)",
        lineHeight: 1.5
      }, children: subtitle })
    ] }),
    /* @__PURE__ */ jsx("div", { style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }, children })
  ] });
}
function Field({
  label,
  children
}) {
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx("div", { style: {
      fontFamily: "var(--mono)",
      fontSize: 10.5,
      fontWeight: 500,
      color: "var(--text-dim)",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      marginBottom: 6
    }, children: label }),
    children
  ] });
}
function CodeBlock({
  value,
  onCopy,
  copied,
  monoSize = 12
}) {
  return /* @__PURE__ */ jsxs("div", { style: {
    background: "var(--surface-0)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  }, children: [
    /* @__PURE__ */ jsx("pre", { style: {
      margin: 0,
      fontFamily: "var(--mono)",
      fontSize: monoSize,
      color: "var(--text)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
      flex: 1
    }, children: value }),
    onCopy && /* @__PURE__ */ jsxs("button", { onClick: onCopy, style: {
      background: copied ? "var(--accent-dim)" : "transparent",
      border: "1px solid var(--border)",
      color: copied ? "var(--accent)" : "var(--text-dim)",
      padding: "4px 8px",
      borderRadius: 5,
      cursor: "pointer",
      fontFamily: "var(--mono)",
      fontSize: 10.5,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      flexShrink: 0
    }, children: [
      /* @__PURE__ */ jsx(Icon, { name: copied ? "check" : "copy", size: 11 }),
      copied ? "copied" : "copy"
    ] })
  ] });
}
export {
  SettingsPage as component
};
