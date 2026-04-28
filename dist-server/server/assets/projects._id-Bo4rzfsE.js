import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { s as AGENT_META, i as useHotkey, t as STATUS_META, S as ShimmerBar, e as StatusDot, I as Icon, B as Btn, n as Kbd, K as KbdAction, v as isEditableTarget, g as getElectron, h as useUserTerminals, c as api, R as Route, w as useProject, x as useTasks, f as useGroups, r as useSettings, y as useFormattedBinding, z as useTerminals, q as queryKeys, b as useServerEvents, P as ProjectIcon } from "./router-XpjizlSW.js";
import { E as EmptyState } from "./EmptyState-B-4KeMG-.js";
import { u as useCardGlow, M as Modal, p as parseLaunchCommands, L as LAUNCH_COMMANDS_MAX, T as TASK_STATUSES, C as CursorGlow, P as ProjectDialog } from "./ProjectDialog-BHF1I7qp.js";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { StreamLanguage } from "@codemirror/language";
import "@tanstack/react-router-with-query";
import "drizzle-orm/sqlite-core";
import "drizzle-orm";
function AgentGlyph({
  agent,
  showLabel = false,
  size = 11
}) {
  const meta = AGENT_META[agent];
  if (!meta) return null;
  return /* @__PURE__ */ jsxs(
    "span",
    {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--mono)",
        fontSize: size,
        color: "var(--text-dim)"
      },
      children: [
        /* @__PURE__ */ jsx("span", { style: { color: meta.color, fontSize: size + 1 }, children: meta.glyph }),
        showLabel && /* @__PURE__ */ jsx("span", { children: meta.label })
      ]
    }
  );
}
const TITLE_WAITING = "Waiting for initial prompt...";
const TITLE_GENERATING = "Generating title...";
function isSentinelTitle(title) {
  return title === TITLE_WAITING || title === TITLE_GENERATING;
}
function TaskCard({
  task,
  selected,
  onToggle,
  onArchive,
  onDelete
}) {
  const [menu, setMenu] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const glowRef = useCardGlow();
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  useHotkey(
    "enter",
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (onDelete) onDelete(task.id);
      setConfirmOpen(false);
    },
    { enabled: confirmOpen }
  );
  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";
  const updated = formatRelative(task.updatedAt);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: glowRef,
      onContextMenu: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onDelete) setMenu({ x: e.clientX, y: e.clientY });
      },
      style: {
        background: selected ? "var(--surface-2)" : "var(--surface-1)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "all 0.15s",
        position: "relative",
        boxShadow: selected ? "0 0 0 1px var(--accent), 0 0 16px var(--accent-faint)" : "none"
      },
      onMouseEnter: (e) => {
        setHovered(true);
        if (!selected) e.currentTarget.style.borderColor = "var(--border-strong)";
      },
      onMouseLeave: (e) => {
        setHovered(false);
        if (!selected) e.currentTarget.style.borderColor = "var(--border)";
      },
      children: [
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => onToggle(task.id),
            "aria-label": `${selected ? "Close" : "Open"} terminal for ${task.title}`,
            "aria-pressed": selected,
            style: {
              position: "absolute",
              inset: 0,
              zIndex: 0,
              background: "transparent",
              border: 0,
              padding: 0,
              margin: 0,
              cursor: "pointer",
              borderRadius: "inherit"
            }
          }
        ),
        /* @__PURE__ */ jsx(ShimmerBar, { active: isRunning, color: meta?.color }),
        /* @__PURE__ */ jsxs("div", { style: { padding: 14, display: "flex", flexDirection: "column", gap: 10, position: "relative", zIndex: 1, pointerEvents: "none" }, children: [
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "flex-start", gap: 10 }, children: [
            /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }, children: [
                /* @__PURE__ */ jsx(StatusDot, { status: task.status, size: 7 }),
                /* @__PURE__ */ jsx(
                  "span",
                  {
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      fontWeight: 500,
                      color: statusMeta.color,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase"
                    },
                    children: statusMeta.label
                  }
                ),
                /* @__PURE__ */ jsx("span", { style: { color: "var(--text-faint)", fontSize: 10, fontFamily: "var(--mono)" }, children: "·" }),
                /* @__PURE__ */ jsx(AgentGlyph, { agent: task.agent, showLabel: true, size: 10.5 })
              ] }),
              (() => {
                const sentinel = isSentinelTitle(task.title);
                return /* @__PURE__ */ jsx(
                  "div",
                  {
                    style: {
                      fontSize: 13.5,
                      fontWeight: 500,
                      lineHeight: 1.35,
                      color: sentinel ? "var(--text-dim)" : "var(--text)",
                      fontStyle: sentinel ? "italic" : "normal",
                      marginBottom: 4
                    },
                    children: task.title
                  }
                );
              })(),
              /* @__PURE__ */ jsxs(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--text-faint)"
                  },
                  children: [
                    /* @__PURE__ */ jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
                      /* @__PURE__ */ jsx(Icon, { name: "git-branch", size: 10 }),
                      " ",
                      task.branch
                    ] }),
                    /* @__PURE__ */ jsx("span", { children: "·" }),
                    /* @__PURE__ */ jsxs("span", { children: [
                      "+",
                      task.lines,
                      " lines"
                    ] }),
                    /* @__PURE__ */ jsx("span", { children: "·" }),
                    /* @__PURE__ */ jsx("span", { children: updated })
                  ]
                }
              )
            ] }),
            /* @__PURE__ */ jsx("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: onDelete && /* @__PURE__ */ jsx(
              "button",
              {
                "aria-label": "Delete task",
                title: "Delete task",
                onClick: (e) => {
                  e.stopPropagation();
                  setConfirmOpen(true);
                },
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  border: 0,
                  borderRadius: 4,
                  background: "transparent",
                  color: "var(--text-faint)",
                  cursor: "pointer",
                  opacity: hovered ? 1 : 0,
                  pointerEvents: hovered ? "auto" : "none",
                  transition: "opacity 0.12s, color 0.12s, background 0.12s",
                  position: "relative",
                  zIndex: 1
                },
                onMouseEnter: (e) => {
                  e.currentTarget.style.color = "var(--status-failed)";
                  e.currentTarget.style.background = "var(--surface-2)";
                },
                onMouseLeave: (e) => {
                  e.currentTarget.style.color = "var(--text-faint)";
                  e.currentTarget.style.background = "transparent";
                },
                children: /* @__PURE__ */ jsx(Icon, { name: "trash", size: 12 })
              }
            ) })
          ] }),
          task.preview && /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-dim)",
                background: "var(--surface-0)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 10px",
                lineHeight: 1.45
              },
              children: [
                task.preview,
                isRunning && /* @__PURE__ */ jsx(
                  "span",
                  {
                    style: {
                      marginLeft: 2,
                      animation: "caret 1s infinite",
                      color: meta?.color
                    },
                    children: "▊"
                  }
                )
              ]
            }
          ),
          task.status === "finished" && /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 6, position: "relative", zIndex: 1, pointerEvents: "auto" }, children: /* @__PURE__ */ jsx(
            Btn,
            {
              size: "sm",
              variant: "ghost",
              icon: "archive",
              onClick: (e) => {
                e.stopPropagation();
                onArchive(task.id);
              },
              children: "Archive"
            }
          ) }),
          menu && onDelete && /* @__PURE__ */ jsx(
            "div",
            {
              role: "menu",
              "aria-label": "Task actions",
              onClick: (e) => e.stopPropagation(),
              style: {
                position: "fixed",
                top: menu.y,
                left: menu.x,
                zIndex: 1e3,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 4,
                minWidth: 140,
                boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
                pointerEvents: "auto"
              },
              children: /* @__PURE__ */ jsxs(
                "button",
                {
                  role: "menuitem",
                  autoFocus: true,
                  onClick: (e) => {
                    e.stopPropagation();
                    setMenu(null);
                    setConfirmOpen(true);
                  },
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "7px 10px",
                    background: "transparent",
                    border: 0,
                    borderRadius: 4,
                    cursor: "pointer",
                    color: "var(--status-needs, #e06c75)",
                    fontSize: 12,
                    fontFamily: "var(--mono)",
                    textAlign: "left"
                  },
                  onMouseEnter: (e) => e.currentTarget.style.background = "var(--surface-3)",
                  onMouseLeave: (e) => e.currentTarget.style.background = "transparent",
                  children: [
                    /* @__PURE__ */ jsx(Icon, { name: "trash", size: 12 }),
                    " Delete"
                  ]
                }
              )
            }
          ),
          task.status === "needs-input" && /* @__PURE__ */ jsx("div", { style: { position: "relative", zIndex: 1, pointerEvents: "auto" }, children: /* @__PURE__ */ jsx(
            Btn,
            {
              size: "sm",
              variant: "accent",
              icon: "terminal",
              onClick: (e) => {
                e.stopPropagation();
                onToggle(task.id);
              },
              children: "Open terminal to reply"
            }
          ) })
        ] }),
        onDelete && /* @__PURE__ */ jsx("div", { onClick: (e) => e.stopPropagation(), children: /* @__PURE__ */ jsxs(
          Modal,
          {
            open: confirmOpen,
            onClose: () => setConfirmOpen(false),
            title: "Delete task",
            width: 420,
            footer: /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsxs(Btn, { variant: "ghost", onClick: () => setConfirmOpen(false), children: [
                "Cancel ",
                /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "Esc" })
              ] }),
              /* @__PURE__ */ jsxs(
                Btn,
                {
                  variant: "danger",
                  icon: "trash",
                  onClick: () => {
                    onDelete(task.id);
                    setConfirmOpen(false);
                  },
                  children: [
                    "Delete ",
                    /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "Enter" })
                  ]
                }
              )
            ] }),
            children: [
              /* @__PURE__ */ jsxs("div", { style: { fontSize: 13, color: "var(--text)", marginBottom: 6 }, children: [
                "Delete “",
                task.title,
                "”?"
              ] }),
              /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: "var(--text-dim)" }, children: "This task and its worktree will be removed. This cannot be undone." })
            ]
          }
        ) })
      ]
    }
  );
}
function formatRelative(ts) {
  const diff = Date.now() - ts;
  if (diff < 6e4) return "just now";
  const m = Math.floor(diff / 6e4);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
function TaskColumn({
  title,
  color,
  tasks,
  activeId,
  onToggle,
  onArchive,
  onDelete
}) {
  if (tasks.length === 0) return null;
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }, children: [
      /* @__PURE__ */ jsx(
        "span",
        {
          style: {
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 6px ${color}66`
          }
        }
      ),
      /* @__PURE__ */ jsx(
        "span",
        {
          style: {
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text)"
          },
          children: title
        }
      ),
      /* @__PURE__ */ jsx(
        "span",
        {
          style: {
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-faint)",
            fontVariantNumeric: "tabular-nums"
          },
          children: tasks.length
        }
      )
    ] }),
    /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 12
        },
        children: tasks.map((t) => /* @__PURE__ */ jsx(
          TaskCard,
          {
            task: t,
            selected: activeId === t.id,
            onToggle,
            onArchive,
            onDelete
          },
          t.id
        ))
      }
    )
  ] });
}
function NewAgentDialog({
  open,
  project,
  onClose,
  onStart,
  onPersistRemember
}) {
  const [agent, setAgent] = useState("claude-code");
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);
  const [rememberSettings, setRememberSettings] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!open) return;
    const seedAgent = project?.rememberAgentSettings && project?.savedAgent ? project.savedAgent : "claude-code";
    const seedSkip = project?.rememberAgentSettings ? !!project.savedSkipPermissions : false;
    setAgent(seedAgent);
    setDangerouslySkipPermissions(seedSkip);
    setRememberSettings(!!project?.rememberAgentSettings);
    setError(null);
    setSubmitting(false);
  }, [open]);
  const agents = [
    {
      id: "claude-code",
      label: "Claude Code",
      desc: "Anthropic's agentic coder. Best for multi-file refactors and reasoning.",
      cmd: "claude"
    },
    {
      id: "codex",
      label: "Codex",
      desc: "OpenAI's terminal coder. Best for test-driven, narrow tasks.",
      cmd: "codex"
    },
    {
      id: "cursor-cli",
      label: "Cursor CLI",
      desc: "Cursor's background agent. Best for quick inline edits.",
      cmd: "cursor-agent"
    }
  ];
  const toggleRemember = async (next) => {
    setRememberSettings(next);
    await onPersistRemember(
      next ? {
        rememberAgentSettings: true,
        savedAgent: agent,
        savedSkipPermissions: agent === "claude-code" ? dangerouslySkipPermissions : false
      } : { rememberAgentSettings: false, savedAgent: null, savedSkipPermissions: false }
    );
  };
  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    if (agent !== "shell") {
      const electron = getElectron();
      if (electron) {
        const cmd = AGENT_META[agent].cmd;
        const probe = await electron.cliCheck(cmd);
        if (!probe.ok) {
          setError(
            `\`${cmd}\` was not found on your PATH. Install ${AGENT_META[agent].label} or pick a different agent.`
          );
          setSubmitting(false);
          return;
        }
      }
    }
    try {
      const skip = agent === "claude-code" && dangerouslySkipPermissions;
      if (rememberSettings) {
        await onPersistRemember({
          rememberAgentSettings: true,
          savedAgent: agent,
          savedSkipPermissions: skip
        });
      }
      await onStart({
        agent,
        title: TITLE_WAITING,
        branch: project?.branch || "main",
        dangerouslySkipPermissions: skip
      });
    } catch (e) {
      setError(e?.message || "Failed to start agent");
    } finally {
      setSubmitting(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const ids = agents.map((a) => a.id);
        const idx = ids.indexOf(agent);
        const next = e.key === "ArrowDown" ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1);
        if (next !== idx) setAgent(ids[next]);
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, agent, agents, submitting, project, rememberSettings, dangerouslySkipPermissions]);
  useHotkey("dialog.submit", () => void submit(), { enabled: open });
  return /* @__PURE__ */ jsx(
    Modal,
    {
      open,
      onClose,
      title: "Start a new agent",
      width: 540,
      footer: /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(Btn, { variant: "ghost", onClick: onClose, children: "Cancel" }),
        /* @__PURE__ */ jsxs(Btn, { variant: "primary", icon: "play", onClick: submit, disabled: submitting, children: [
          "Start agent",
          /* @__PURE__ */ jsx(KbdAction, { action: "dialog.submit", variant: "onPrimary" })
        ] })
      ] }),
      children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 18 }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(
            "label",
            {
              style: {
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                fontWeight: 500,
                color: "var(--text-dim)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                display: "block",
                marginBottom: 8
              },
              children: "Agent"
            }
          ),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: agents.map((a) => {
            const meta = AGENT_META[a.id];
            const selected = agent === a.id;
            return /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: () => setAgent(a.id),
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                  padding: "12px 14px",
                  background: selected ? "var(--surface-2)" : "var(--surface-0)",
                  border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  color: "var(--text)",
                  boxShadow: selected ? "0 0 0 1px var(--accent)" : "none"
                },
                children: [
                  /* @__PURE__ */ jsx(
                    "div",
                    {
                      style: {
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        background: `${meta.color}22`,
                        border: `1px solid ${meta.color}44`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: meta.color,
                        fontSize: 15,
                        fontFamily: "var(--mono)"
                      },
                      children: meta.glyph
                    }
                  ),
                  /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
                    /* @__PURE__ */ jsx("div", { style: { fontSize: 13, fontWeight: 600, marginBottom: 2 }, children: a.label }),
                    /* @__PURE__ */ jsx(
                      "div",
                      {
                        style: {
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--text-dim)",
                          lineHeight: 1.4
                        },
                        children: a.desc
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsxs(
                    "code",
                    {
                      style: {
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: "var(--text-faint)",
                        background: "var(--surface-0)",
                        padding: "3px 7px",
                        border: "1px solid var(--border)",
                        borderRadius: 4
                      },
                      children: [
                        "$",
                        a.cmd
                      ]
                    }
                  )
                ]
              },
              a.id
            );
          }) })
        ] }),
        agent === "claude-code" && /* @__PURE__ */ jsxs(
          "label",
          {
            style: {
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              cursor: "pointer"
            },
            children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: dangerouslySkipPermissions,
                  onChange: (e) => setDangerouslySkipPermissions(e.target.checked),
                  style: { marginTop: 2, accentColor: "var(--accent)" }
                }
              ),
              /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
                /* @__PURE__ */ jsx("div", { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 2 }, children: "Skip permission prompts" }),
                /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--text-dim)",
                      lineHeight: 1.4
                    },
                    children: [
                      "Launches with",
                      " ",
                      /* @__PURE__ */ jsx("code", { style: { color: "var(--text)" }, children: "--dangerously-skip-permissions" }),
                      "."
                    ]
                  }
                )
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "label",
          {
            style: {
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              cursor: "pointer"
            },
            children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: rememberSettings,
                  onChange: (e) => void toggleRemember(e.target.checked),
                  style: { marginTop: 2, accentColor: "var(--accent)" }
                }
              ),
              /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
                /* @__PURE__ */ jsx("div", { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 2 }, children: "Remember settings for this project" }),
                /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--text-dim)",
                      lineHeight: 1.4
                    },
                    children: [
                      "The New agent button will skip this dialog and start",
                      " ",
                      /* @__PURE__ */ jsx("code", { style: { color: "var(--text)" }, children: AGENT_META[agent].label }),
                      " directly."
                    ]
                  }
                )
              ] })
            ]
          }
        ),
        error && /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              padding: "8px 12px",
              border: "1px solid var(--status-failed)",
              background: "color-mix(in oklch, var(--status-failed) 12%, transparent)",
              borderRadius: 7,
              color: "var(--status-failed)",
              fontFamily: "var(--mono)",
              fontSize: 11.5
            },
            children: error
          }
        )
      ] })
    }
  );
}
function fuzzyScore(query, target) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const slash = t.lastIndexOf("/");
  const base = slash >= 0 ? t.slice(slash + 1) : t;
  const baseIdx = base.indexOf(q);
  if (baseIdx >= 0) {
    const effectiveIdx = baseIdx === 1 && base.charCodeAt(0) === 46 ? 0 : baseIdx;
    let score = 1e3 - effectiveIdx + (effectiveIdx === 0 ? 50 : 0);
    if (q.length === base.length || baseIdx === 1 && q.length + 1 === base.length) {
      score += 200;
    }
    return score;
  }
  const pathIdx = t.indexOf(q);
  if (pathIdx >= 0) return 500 - pathIdx;
  const baseSub = subseq(q, base);
  if (baseSub > 0) return 200 + baseSub;
  const pathSub = subseq(q, t);
  if (pathSub > 0) return 50 + pathSub;
  return 0;
}
function subseq(q, t) {
  let qi = 0;
  let lastIdx = -1;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t.charCodeAt(ti) === q.charCodeAt(qi)) {
      const gap = lastIdx < 0 ? 0 : ti - lastIdx - 1;
      score += Math.max(1, 10 - gap);
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}
function rankFiles(query, files, limit = 200) {
  if (!query) return files.slice(0, limit).map((p) => ({ path: p, score: 1 }));
  const out = [];
  for (const p of files) {
    const s = fuzzyScore(query, p);
    if (s > 0) out.push({ path: p, score: s });
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.length - b.path.length;
  });
  if (out.length > limit) out.length = limit;
  return out;
}
const VISIBLE_LIMIT = 200;
function FileFinderDialog({
  open,
  projectRoot,
  onClose,
  onPick
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const itemRefs = useRef([]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["files:list", projectRoot],
    queryFn: async () => {
      if (!window.electronAPI) throw new Error("Not running in Electron");
      const r = await window.electronAPI.files.list(projectRoot);
      if (!r.ok) throw new Error(r.error);
      return r.files;
    },
    enabled: open && !!projectRoot,
    staleTime: 3e4
  });
  const ranked = useMemo(() => {
    const files = data ?? [];
    return rankFiles(query.trim(), files, VISIBLE_LIMIT);
  }, [data, query]);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    void refetch();
  }, [open, refetch]);
  useEffect(() => {
    if (highlight >= ranked.length) setHighlight(0);
  }, [ranked, highlight]);
  useEffect(() => {
    if (!open) return;
    itemRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);
  useHotkey(
    "escape",
    (e) => {
      if (!open) return;
      e.stopPropagation();
      onClose();
    },
    { enabled: open, preventDefault: false }
  );
  const choose = (p) => {
    onPick(p);
    onClose();
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = ranked.length;
      if (n > 0) setHighlight((h) => (h + 1) % n);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = ranked.length;
      if (n > 0) setHighlight((h) => (h - 1 + n) % n);
      return;
    }
    if (e.key === "Enter") {
      const target = ranked[highlight];
      if (target) {
        e.preventDefault();
        choose(target.path);
      }
    }
  };
  if (!open) return null;
  return /* @__PURE__ */ jsx(
    "div",
    {
      "data-modal-open": true,
      onClick: onClose,
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        animation: "fade-up 0.12s ease-out"
      },
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: {
            width: 640,
            maxWidth: "92vw",
            maxHeight: "70vh",
            background: "var(--surface-1)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
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
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--border)"
                },
                children: [
                  /* @__PURE__ */ jsx(Icon, { name: "search", size: 13, style: { color: "var(--text-faint)" } }),
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      ref: inputRef,
                      value: query,
                      onChange: (e) => {
                        setQuery(e.target.value);
                        setHighlight(0);
                      },
                      onKeyDown,
                      placeholder: "Search files in this project…",
                      style: {
                        flex: 1,
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        fontFamily: "var(--mono)",
                        fontSize: 13,
                        color: "var(--text)"
                      }
                    }
                  ),
                  /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "Esc" })
                ]
              }
            ),
            /* @__PURE__ */ jsx("div", { style: { flex: 1, overflowY: "auto", padding: 4 }, children: error ? /* @__PURE__ */ jsxs(Status$1, { children: [
              "Error: ",
              String(error.message)
            ] }) : isLoading && !data ? /* @__PURE__ */ jsx(Status$1, { children: "Indexing…" }) : ranked.length === 0 ? /* @__PURE__ */ jsx(Status$1, { children: (data?.length ?? 0) === 0 ? "No files found." : "No matches." }) : ranked.map((r, i) => {
              const slash = r.path.lastIndexOf("/");
              const dir = slash >= 0 ? r.path.slice(0, slash) : "";
              const base = slash >= 0 ? r.path.slice(slash + 1) : r.path;
              const highlighted = i === highlight;
              return /* @__PURE__ */ jsxs(
                "button",
                {
                  ref: (el) => {
                    itemRefs.current[i] = el;
                  },
                  onClick: () => choose(r.path),
                  onMouseMove: () => setHighlight(i),
                  style: {
                    width: "100%",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "6px 10px",
                    background: highlighted ? "var(--surface-2, var(--surface-1))" : "transparent",
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
                    /* @__PURE__ */ jsx("span", { style: { flexShrink: 0, fontWeight: 600 }, children: base }),
                    dir && /* @__PURE__ */ jsx(
                      "span",
                      {
                        style: {
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--text-faint)",
                          fontSize: 11
                        },
                        children: dir
                      }
                    )
                  ]
                },
                r.path
              );
            }) }),
            /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 14px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--surface-0)",
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--text-faint)"
                },
                children: [
                  /* @__PURE__ */ jsx("span", { children: data ? `${ranked.length} / ${data.length}` : "—" }),
                  /* @__PURE__ */ jsxs("span", { style: { display: "flex", gap: 10, alignItems: "center" }, children: [
                    /* @__PURE__ */ jsxs("span", { children: [
                      /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "↑↓" }),
                      " navigate"
                    ] }),
                    /* @__PURE__ */ jsxs("span", { children: [
                      /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "Enter" }),
                      " open"
                    ] })
                  ] })
                ]
              }
            )
          ]
        }
      )
    }
  );
}
function Status$1({ children }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        padding: 14,
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--text-faint)",
        textAlign: "center"
      },
      children
    }
  );
}
const envLanguage = StreamLanguage.define({
  name: "dotenv",
  token(stream) {
    if (stream.sol() && stream.match(/#.*/)) return "comment";
    if (stream.sol() && stream.match(/[A-Za-z_][A-Za-z0-9_]*(?==)/)) return "variableName";
    if (stream.match("=")) return "operator";
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.next() == null) return null;
    return null;
  }
});
function languageForFilename(name) {
  const lower = name.toLowerCase();
  const base = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  if (base === ".env" || base.startsWith(".env.") || base.endsWith(".env")) {
    return [envLanguage];
  }
  if (base.endsWith(".json") || base === "package.json" || base.endsWith(".jsonc")) {
    return [json()];
  }
  if (base.endsWith(".ts") || base.endsWith(".tsx")) {
    return [javascript({ typescript: true, jsx: base.endsWith(".tsx") })];
  }
  if (base.endsWith(".js") || base.endsWith(".jsx") || base.endsWith(".mjs") || base.endsWith(".cjs")) {
    return [javascript({ jsx: base.endsWith(".jsx") })];
  }
  return [];
}
function FileEditorDialog({
  projectRoot,
  relPath,
  onClose
}) {
  const open = relPath !== null;
  const [loaded, setLoaded] = useState(null);
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const watchIdRef = useRef(null);
  const cmRef = useRef(null);
  const dirty = loaded !== null && content !== loaded.content;
  const slash = relPath ? relPath.lastIndexOf("/") : -1;
  const fileName = relPath ? slash >= 0 ? relPath.slice(slash + 1) : relPath : "";
  const dirPath = relPath && slash >= 0 ? relPath.slice(0, slash) : "";
  useEffect(() => {
    if (!open || !relPath || !window.electronAPI) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoaded(null);
    setContent("");
    setExternalChanged(false);
    setSaveError(null);
    void (async () => {
      const r = await window.electronAPI.files.read(projectRoot, relPath);
      if (cancelled) return;
      if (r.ok) {
        setLoaded({ content: r.content, mtimeMs: r.mtimeMs });
        setContent(r.content);
      } else {
        setLoadError({ kind: r.error, lineCount: r.lineCount });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectRoot, relPath]);
  useEffect(() => {
    if (!open || !relPath || !loaded || !window.electronAPI) return;
    let active = true;
    let unsub;
    void (async () => {
      const r = await window.electronAPI.files.watch(projectRoot, relPath);
      if (!active) {
        if (r.ok) void window.electronAPI.files.unwatch(r.watchId);
        return;
      }
      if (!r.ok) return;
      watchIdRef.current = r.watchId;
      unsub = window.electronAPI.files.onChanged((msg) => {
        if (msg.watchId !== r.watchId) return;
        void handleExternalChange();
      });
    })();
    return () => {
      active = false;
      unsub?.();
      const id = watchIdRef.current;
      watchIdRef.current = null;
      if (id) void window.electronAPI?.files.unwatch(id);
    };
  }, [open, projectRoot, relPath, loaded?.mtimeMs]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const handleExternalChange = useCallback(async () => {
    if (!relPath || !window.electronAPI) return;
    const r = await window.electronAPI.files.read(projectRoot, relPath);
    if (!r.ok) return;
    if (dirtyRef.current) {
      setLoaded((prev) => prev ? { ...prev, mtimeMs: r.mtimeMs } : prev);
      setExternalChanged(true);
      return;
    }
    const view = cmRef.current?.view;
    const scrollTop = view?.scrollDOM.scrollTop ?? 0;
    const selection = view?.state.selection;
    setLoaded({ content: r.content, mtimeMs: r.mtimeMs });
    setContent(r.content);
    setExternalChanged(false);
    requestAnimationFrame(() => {
      const v = cmRef.current?.view;
      if (!v) return;
      v.scrollDOM.scrollTop = scrollTop;
      if (selection) {
        try {
          v.dispatch({ selection });
        } catch {
        }
      }
    });
  }, [projectRoot, relPath]);
  const doSave = useCallback(
    async (forceOverwrite) => {
      if (!relPath || !window.electronAPI || !loaded) return;
      setSaving(true);
      setSaveError(null);
      const r = await window.electronAPI.files.write(
        projectRoot,
        relPath,
        content,
        forceOverwrite ? null : loaded.mtimeMs
      );
      setSaving(false);
      if (r.ok) {
        setLoaded({ content, mtimeMs: r.mtimeMs });
        setExternalChanged(false);
        return;
      }
      if (r.error === "stale") {
        setExternalChanged(true);
        setSaveError("File changed on disk. Discard your edits and reload, or overwrite anyway.");
        return;
      }
      setSaveError(r.error);
    },
    [projectRoot, relPath, loaded, content]
  );
  const discardAndReload = useCallback(async () => {
    if (!relPath || !window.electronAPI) return;
    const r = await window.electronAPI.files.read(projectRoot, relPath);
    if (!r.ok) return;
    setLoaded({ content: r.content, mtimeMs: r.mtimeMs });
    setContent(r.content);
    setExternalChanged(false);
    setSaveError(null);
  }, [projectRoot, relPath]);
  useHotkey("file.save", (e) => {
    if (!open) return;
    e.preventDefault();
    void doSave(false);
  }, { enabled: open });
  useHotkey(
    "escape",
    (e) => {
      if (!open) return;
      e.stopPropagation();
      requestClose();
    },
    { enabled: open, preventDefault: false }
  );
  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [onClose]);
  if (!open) return null;
  const extensions = [
    EditorView.lineWrapping,
    ...relPath ? languageForFilename(relPath) : []
  ];
  return /* @__PURE__ */ jsxs(
    "div",
    {
      "data-modal-open": true,
      onClick: requestClose,
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "fade-up 0.12s ease-out"
      },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            onClick: (e) => e.stopPropagation(),
            style: {
              width: "80vw",
              height: "82vh",
              maxWidth: 1200,
              background: "var(--surface-1)",
              border: "1px solid var(--border-strong)",
              borderRadius: 12,
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column",
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
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--border)",
                    minWidth: 0
                  },
                  children: [
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        style: {
                          fontFamily: "var(--mono)",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--text)",
                          flexShrink: 0
                        },
                        children: fileName
                      }
                    ),
                    dirPath && /* @__PURE__ */ jsx(
                      "span",
                      {
                        style: {
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--text-faint)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minWidth: 0,
                          flex: 1
                        },
                        title: dirPath,
                        children: dirPath
                      }
                    ),
                    dirty && /* @__PURE__ */ jsx(
                      "span",
                      {
                        title: "Unsaved changes",
                        style: {
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: "var(--accent)",
                          flexShrink: 0
                        }
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        onClick: requestClose,
                        "aria-label": "Close",
                        style: {
                          background: "transparent",
                          border: 0,
                          color: "var(--text-dim)",
                          cursor: "pointer",
                          padding: 4,
                          display: "flex",
                          flexShrink: 0
                        },
                        children: /* @__PURE__ */ jsx(Icon, { name: "x", size: 13 })
                      }
                    )
                  ]
                }
              ),
              externalChanged && /* @__PURE__ */ jsxs(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 16px",
                    background: "var(--surface-0)",
                    borderBottom: "1px solid var(--border)",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "var(--text-dim)"
                  },
                  children: [
                    /* @__PURE__ */ jsxs("span", { style: { flex: 1 }, children: [
                      "File changed on disk. ",
                      dirty ? "You have unsaved edits." : ""
                    ] }),
                    /* @__PURE__ */ jsx(Btn, { size: "sm", variant: "ghost", onClick: discardAndReload, children: "Discard mine & reload" }),
                    /* @__PURE__ */ jsx(Btn, { size: "sm", variant: "ghost", onClick: () => doSave(true), children: "Overwrite" })
                  ]
                }
              ),
              /* @__PURE__ */ jsx("div", { style: { flex: 1, minHeight: 0, overflow: "auto", background: "#282c34" }, children: loading ? /* @__PURE__ */ jsx(Status, { children: "Loading…" }) : loadError ? /* @__PURE__ */ jsx(
                LoadErrorView,
                {
                  kind: loadError.kind,
                  lineCount: loadError.lineCount,
                  onClose
                }
              ) : /* @__PURE__ */ jsx(
                CodeMirror,
                {
                  ref: cmRef,
                  value: content,
                  theme: oneDark,
                  extensions,
                  onChange: (v) => setContent(v),
                  basicSetup: {
                    lineNumbers: true,
                    highlightActiveLine: true,
                    highlightActiveLineGutter: true,
                    foldGutter: true
                  },
                  style: { fontSize: 13, height: "100%" }
                }
              ) }),
              saveError && !externalChanged && /* @__PURE__ */ jsx(
                "div",
                {
                  style: {
                    padding: "6px 16px",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    color: "var(--status-failed)",
                    background: "var(--surface-0)",
                    borderTop: "1px solid var(--border)"
                  },
                  children: saveError
                }
              ),
              /* @__PURE__ */ jsxs(
                "div",
                {
                  style: {
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 16px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface-0)"
                  },
                  children: [
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        style: {
                          flex: 1,
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          color: "var(--text-faint)"
                        },
                        children: loaded ? `${content.length.toLocaleString()} chars` : ""
                      }
                    ),
                    /* @__PURE__ */ jsxs(Btn, { variant: "ghost", onClick: requestClose, children: [
                      "Close ",
                      /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "Esc" })
                    ] }),
                    /* @__PURE__ */ jsxs(
                      Btn,
                      {
                        variant: "primary",
                        icon: "check",
                        onClick: () => doSave(false),
                        disabled: !loaded || saving || !dirty,
                        children: [
                          saving ? "Saving…" : "Save",
                          /* @__PURE__ */ jsx(KbdAction, { action: "file.save", variant: "onPrimary" })
                        ]
                      }
                    )
                  ]
                }
              )
            ]
          }
        ),
        confirmClose && /* @__PURE__ */ jsx(
          ConfirmDiscardOverlay,
          {
            onCancel: () => setConfirmClose(false),
            onDiscard: () => {
              setConfirmClose(false);
              onClose();
            }
          }
        )
      ]
    }
  );
}
function Status({ children }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        padding: 24,
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--text-faint)",
        textAlign: "center"
      },
      children
    }
  );
}
function LoadErrorView({
  kind,
  lineCount,
  onClose
}) {
  let title = "Could not open file";
  let body = String(kind);
  if (kind === "too-large") {
    title = "File too large to open";
    body = lineCount && lineCount > 0 ? `This file has ${lineCount.toLocaleString()} lines (limit is 1,000). If this is production code, consider splitting it up and decomposing it into smaller modules.` : "This file exceeds the 1,000-line / 5 MB limit. If this is production code, consider splitting it up and decomposing it into smaller modules.";
  } else if (kind === "binary") {
    title = "Binary file";
    body = "This file appears to be binary and cannot be edited as text.";
  } else if (kind === "not-found") {
    title = "File not found";
    body = "The file no longer exists on disk.";
  }
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        padding: 32,
        fontFamily: "var(--mono)",
        fontSize: 13,
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "flex-start"
      },
      children: [
        /* @__PURE__ */ jsx("div", { style: { fontWeight: 600 }, children: title }),
        /* @__PURE__ */ jsx("div", { style: { color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }, children: body }),
        /* @__PURE__ */ jsx(Btn, { variant: "ghost", onClick: onClose, children: "Close" })
      ]
    }
  );
}
function ConfirmDiscardOverlay({
  onCancel,
  onDiscard
}) {
  useHotkey("escape", (e) => {
    e.stopPropagation();
    onCancel();
  }, { preventDefault: false });
  return /* @__PURE__ */ jsx(
    "div",
    {
      onClick: onCancel,
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 110,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      },
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: {
            width: 420,
            maxWidth: "92vw",
            background: "var(--surface-1)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
          },
          children: [
            /* @__PURE__ */ jsx("div", { style: { fontSize: 13, fontWeight: 600 }, children: "Discard unsaved changes?" }),
            /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }, children: "You have unsaved edits. Closing the editor will discard them." }),
            /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }, children: [
              /* @__PURE__ */ jsxs(Btn, { variant: "ghost", onClick: onCancel, children: [
                "Cancel ",
                /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "Esc" })
              ] }),
              /* @__PURE__ */ jsx(Btn, { variant: "danger", onClick: onDiscard, children: "Discard" })
            ] })
          ]
        }
      )
    }
  );
}
function newRowId() {
  return `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function LaunchCommandsDialog({
  open,
  project,
  onClose,
  onSave
}) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setRows(parseLaunchCommands(project?.launchCommands ?? null));
  }, [open, project]);
  const update = (id, patch) => setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  const remove = (id) => setRows((prev) => prev.filter((r) => r.id !== id));
  const add = () => {
    if (rows.length >= LAUNCH_COMMANDS_MAX) return;
    setRows((prev) => [...prev, { id: newRowId(), name: "", command: "" }]);
  };
  const save = async () => {
    setError(null);
    const cleaned = [];
    for (const r of rows) {
      const name = r.name.trim();
      const command = r.command.trim();
      if (!name && !command) continue;
      if (!name || !command) {
        setError("Every row needs both a name and a command.");
        return;
      }
      cleaned.push({ id: r.id, name, command });
    }
    if (cleaned.length > LAUNCH_COMMANDS_MAX) {
      setError(`At most ${LAUNCH_COMMANDS_MAX} commands.`);
      return;
    }
    try {
      setSaving(true);
      await onSave(cleaned);
      onClose();
    } catch (e) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ jsx(
    Modal,
    {
      open,
      onClose,
      title: "Launch commands",
      width: 640,
      footer: /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(Btn, { variant: "ghost", onClick: onClose, disabled: saving, children: "Cancel" }),
        /* @__PURE__ */ jsx(Btn, { variant: "primary", icon: "check", onClick: save, disabled: saving, children: saving ? "Saving…" : "Save" })
      ] }),
      children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
        /* @__PURE__ */ jsxs(
          "p",
          {
            style: {
              margin: 0,
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.5
            },
            children: [
              "Configure up to ",
              LAUNCH_COMMANDS_MAX,
              " commands. Pressing Launch kills any matching managed terminals and spawns one new terminal per command in the bottom panel."
            ]
          }
        ),
        rows.length === 0 && /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              padding: 16,
              border: "1px dashed var(--border)",
              borderRadius: 8,
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-faint)",
              textAlign: "center"
            },
            children: "No commands yet. Add one to get started."
          }
        ),
        rows.map((r, i) => /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: 10,
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 8
            },
            children: [
              /* @__PURE__ */ jsx(
                "span",
                {
                  style: {
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--text-faint)",
                    width: 16,
                    textAlign: "center"
                  },
                  children: i + 1
                }
              ),
              /* @__PURE__ */ jsx(
                "input",
                {
                  autoFocus: i === rows.length - 1 && !r.name && !r.command,
                  value: r.name,
                  onChange: (e) => update(r.id, { name: e.target.value }),
                  placeholder: "Name (e.g. dev)",
                  style: {
                    flex: "0 0 160px",
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontFamily: "var(--sans)",
                    fontSize: 12.5,
                    padding: "6px 8px",
                    borderRadius: 6,
                    outline: "none"
                  }
                }
              ),
              /* @__PURE__ */ jsx(
                "input",
                {
                  value: r.command,
                  onChange: (e) => update(r.id, { command: e.target.value }),
                  placeholder: "Command (e.g. pnpm dev)",
                  style: {
                    flex: 1,
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    padding: "6px 8px",
                    borderRadius: 6,
                    outline: "none"
                  }
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: () => remove(r.id),
                  title: "Remove",
                  style: {
                    background: "transparent",
                    border: 0,
                    color: "var(--text-faint)",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex"
                  },
                  children: /* @__PURE__ */ jsx(Icon, { name: "trash", size: 12 })
                }
              )
            ]
          },
          r.id
        )),
        /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsxs(
          Btn,
          {
            variant: "ghost",
            icon: "plus",
            size: "sm",
            onClick: add,
            disabled: rows.length >= LAUNCH_COMMANDS_MAX,
            children: [
              "Add command",
              " ",
              /* @__PURE__ */ jsxs("span", { style: { color: "var(--text-faint)", marginLeft: 6 }, children: [
                rows.length,
                "/",
                LAUNCH_COMMANDS_MAX
              ] })
            ]
          }
        ) }),
        error && /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--status-failed)"
            },
            children: error
          }
        )
      ] })
    }
  );
}
function LaunchButton({
  project,
  onProjectUpdated,
  compact = false
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [launching, setLaunching] = useState(false);
  const { createTerminal, killTerminalsByStartCommand, setPanelOpen } = useUserTerminals();
  const commands = parseLaunchCommands(project.launchCommands ?? null);
  const launch = async () => {
    if (commands.length === 0) {
      setShowEmpty(true);
      return;
    }
    setLaunching(true);
    try {
      await killTerminalsByStartCommand(commands.map((c) => c.command));
      for (const c of commands) {
        await createTerminal({ name: c.name, startCommand: c.command });
      }
      setPanelOpen(true);
    } finally {
      setLaunching(false);
    }
  };
  const saveCommands = async (next) => {
    await api.updateProject(project.id, { launchCommands: next });
    await onProjectUpdated();
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "inline-flex" }, children: [
      /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: launch,
          disabled: launching,
          title: commands.length === 0 ? "Configure launch commands" : `Launch ${commands.length} command${commands.length === 1 ? "" : "s"}`,
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            height: 30,
            padding: compact ? 0 : "0 12px",
            width: compact ? 30 : void 0,
            background: "var(--surface-2)",
            border: "1px solid var(--border-strong)",
            borderRight: "none",
            borderRadius: "7px 0 0 7px",
            color: "var(--text)",
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: launching ? "wait" : "pointer",
            transition: "background 0.12s"
          },
          onMouseEnter: (e) => {
            if (!launching) e.currentTarget.style.background = "var(--surface-3)";
          },
          onMouseLeave: (e) => {
            e.currentTarget.style.background = "var(--surface-2)";
          },
          children: [
            /* @__PURE__ */ jsx(Icon, { name: "play", size: 13 }),
            !compact && (launching ? "Launching…" : "Launch")
          ]
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          onClick: () => setShowConfig(true),
          title: "Configure launch commands",
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 30,
            width: 30,
            background: "var(--surface-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: "0 7px 7px 0",
            color: "var(--text-dim)",
            cursor: "pointer",
            transition: "background 0.12s"
          },
          onMouseEnter: (e) => {
            e.currentTarget.style.background = "var(--surface-3)";
          },
          onMouseLeave: (e) => {
            e.currentTarget.style.background = "var(--surface-2)";
          },
          children: /* @__PURE__ */ jsx(Icon, { name: "settings", size: 13 })
        }
      )
    ] }),
    /* @__PURE__ */ jsx(
      LaunchCommandsDialog,
      {
        open: showConfig,
        project,
        onClose: () => setShowConfig(false),
        onSave: saveCommands
      }
    ),
    /* @__PURE__ */ jsx(
      Modal,
      {
        open: showEmpty,
        onClose: () => setShowEmpty(false),
        title: "No launch commands",
        width: 420,
        footer: /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Btn, { variant: "ghost", onClick: () => setShowEmpty(false), children: "Close" }),
          /* @__PURE__ */ jsx(
            Btn,
            {
              variant: "primary",
              icon: "settings",
              onClick: () => {
                setShowEmpty(false);
                setShowConfig(true);
              },
              children: "Configure"
            }
          )
        ] }),
        children: /* @__PURE__ */ jsx("p", { style: { margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }, children: "You haven't configured any launch commands for this project yet. Open the configuration modal to add up to 5 commands that will run when you press Launch." })
      }
    )
  ] });
}
function NewAgentButton({
  project,
  onPrimary,
  onConfigure,
  disabled
}) {
  const remembered = !!(project.rememberAgentSettings && project.savedAgent);
  if (!remembered) {
    return /* @__PURE__ */ jsxs(Btn, { variant: "primary", icon: "plus", onClick: onPrimary, disabled, children: [
      "New agent",
      /* @__PURE__ */ jsx(KbdAction, { action: "agent.new", variant: "onPrimary" })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { style: { display: "inline-flex" }, children: [
    /* @__PURE__ */ jsxs(
      Btn,
      {
        variant: "primary",
        icon: "plus",
        onClick: onPrimary,
        disabled,
        title: `Start ${project.savedAgent} directly — click the gear to change`,
        style: { borderRadius: "7px 0 0 7px", borderRight: "none" },
        children: [
          "New agent",
          /* @__PURE__ */ jsx(KbdAction, { action: "agent.new", variant: "onPrimary" })
        ]
      }
    ),
    /* @__PURE__ */ jsx(
      Btn,
      {
        variant: "primary",
        icon: "settings",
        onClick: onConfigure,
        title: "Change agent settings",
        "aria-label": "Change agent settings",
        style: {
          borderRadius: "0 7px 7px 0",
          padding: 0,
          width: 30,
          borderLeft: "1px solid color-mix(in oklch, var(--accent) 60%, black)"
        }
      }
    )
  ] });
}
function ProjectPage() {
  const {
    id
  } = Route.useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    data: project,
    error: projectError
  } = useProject(id);
  const {
    data: tasks = []
  } = useTasks(id);
  const {
    data: groups = []
  } = useGroups();
  const {
    data: settings
  } = useSettings();
  const apiToken = settings?.apiToken ?? null;
  const [filter, setFilter] = useState("active");
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [fileFinderOpen, setFileFinderOpen] = useState(false);
  const [openFileRel, setOpenFileRel] = useState(null);
  useEffect(() => {
    if (projectError) router.navigate({
      to: "/"
    });
  }, [projectError, router]);
  const editProjectHotkey = useFormattedBinding("project.edit");
  const headerRef = useRef(null);
  const [headerNarrow, setHeaderNarrow] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setHeaderNarrow(entry.contentRect.width < 720);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const terminals = useTerminals();
  const {
    setProject: setActiveUserTerminalProject
  } = useUserTerminals();
  useEffect(() => {
    if (project) setActiveUserTerminalProject(project);
  }, [project, setActiveUserTerminalProject]);
  const invalidateProject = useCallback(() => queryClient.invalidateQueries({
    queryKey: queryKeys.project(id)
  }), [queryClient, id]);
  const invalidateTasks = useCallback(() => queryClient.invalidateQueries({
    queryKey: queryKeys.tasks(id)
  }), [queryClient, id]);
  const invalidateProjects = useCallback(() => queryClient.invalidateQueries({
    queryKey: queryKeys.projects
  }), [queryClient]);
  const refresh = useCallback(async () => {
    await Promise.all([invalidateProject(), invalidateTasks(), invalidateProjects()]);
  }, [invalidateProject, invalidateTasks, invalidateProjects]);
  const startWithSaved = useCallback(async () => {
    if (!project || !apiToken) return;
    if (!(project.rememberAgentSettings && project.savedAgent)) return;
    const created = await api.createTaskInternal(project.id, {
      title: TITLE_WAITING,
      agent: project.savedAgent,
      branch: project.branch || "main"
    }, apiToken);
    await refresh();
    const startCommandOverride = project.savedAgent === "claude-code" && project.savedSkipPermissions ? "claude --dangerously-skip-permissions" : void 0;
    terminals.toggle(project, created.task, {
      startCommandOverride
    });
  }, [project, apiToken, refresh, terminals]);
  const onNewAgentPrimary = useCallback(() => {
    if (showNewAgent || showEdit) return;
    if (project?.rememberAgentSettings && project.savedAgent) {
      void startWithSaved();
      return;
    }
    setShowNewAgent(true);
  }, [project, showNewAgent, showEdit, startWithSaved]);
  useHotkey("agent.new", onNewAgentPrimary, {
    ignoreEditable: true
  });
  useHotkey("project.edit", () => {
    if (showNewAgent) return;
    setShowEdit((v) => !v);
  });
  useHotkey("file.finder", () => {
    if (openFileRel || showNewAgent || showEdit || confirmRemove) return;
    setFileFinderOpen((v) => !v);
  }, {
    ignoreEditable: true
  });
  const closePanelEnabled = !showNewAgent && !showEdit && !confirmRemove && terminals.active !== null;
  useHotkey("terminal.close", () => terminals.deselect(), {
    enabled: closePanelEnabled,
    capture: true
  });
  useServerEvents(useCallback((e) => {
    if (e.type.startsWith("task:")) {
      void invalidateTasks();
      void invalidateProject();
    } else if (e.type.startsWith("project:")) {
      void invalidateProject();
      void invalidateProjects();
    }
  }, [invalidateTasks, invalidateProject, invalidateProjects]));
  if (!project) {
    return /* @__PURE__ */ jsx("div", { role: "status", "aria-live": "polite", style: {
      flex: 1,
      padding: 32,
      color: "var(--text-dim)",
      fontFamily: "var(--mono)",
      fontSize: 12
    }, children: "Loading…" });
  }
  const visibleTasks = tasks.filter((t) => filter === "archived" ? t.archived : !t.archived);
  const tasksByStatus = TASK_STATUSES.reduce((acc, s) => {
    acc[s] = [];
    return acc;
  }, {});
  for (const t of visibleTasks) tasksByStatus[t.status].push(t);
  const activeId = terminals.active && terminals.active.project.id === project.id ? terminals.active.taskId : null;
  const toggleTerminal = (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    terminals.toggle(project, task);
  };
  const archive = async (taskId) => {
    await api.archiveTask(taskId);
    await terminals.close(taskId);
    await refresh();
  };
  const deleteTask = async (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    await terminals.close(taskId);
    await api.deleteTask(taskId);
    await refresh();
  };
  const remove = () => {
    setConfirmRemove(true);
  };
  const confirmRemoveProject = async () => {
    if (!project) return;
    setConfirmRemove(false);
    await terminals.closeForProject(project.id);
    await api.deleteProject(project.id);
    router.navigate({
      to: "/"
    });
  };
  const startAgent = async (data) => {
    if (!apiToken) return;
    const created = await api.createTaskInternal(project.id, {
      title: data.title,
      agent: data.agent,
      branch: data.branch
    }, apiToken);
    setShowNewAgent(false);
    await refresh();
    const startCommandOverride = data.agent === "claude-code" && data.dangerouslySkipPermissions ? "claude --dangerously-skip-permissions" : void 0;
    terminals.toggle(project, created.task, {
      startCommandOverride
    });
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(CursorGlow, {}),
    /* @__PURE__ */ jsxs("div", { style: {
      flex: 1,
      overflow: "auto",
      padding: "24px 32px 80px"
    }, className: "dot-grid-bg", children: [
      /* @__PURE__ */ jsxs("div", { style: {
        maxWidth: 1100,
        margin: "0 auto"
      }, children: [
        /* @__PURE__ */ jsxs("div", { ref: headerRef, style: {
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
          paddingBottom: 20,
          borderBottom: "1px solid var(--border)"
        }, children: [
          /* @__PURE__ */ jsx(ProjectIcon, { project, size: 52 }),
          /* @__PURE__ */ jsxs("div", { style: {
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            overflow: "hidden"
          }, children: [
            /* @__PURE__ */ jsx("h1", { style: {
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0
            }, title: project.name, children: project.name }),
            project.pinned && /* @__PURE__ */ jsx(Icon, { name: "pin-fill", size: 13, style: {
              color: "var(--accent)",
              flexShrink: 0
            } }),
            /* @__PURE__ */ jsx(Btn, { variant: "ghost", size: "sm", icon: "folder", onClick: () => window.electronAPI?.openPath(project.path), title: `Reveal in Finder — ${project.path}`, "aria-label": "Reveal project folder in Finder", style: {
              flexShrink: 0
            } })
          ] }),
          /* @__PURE__ */ jsxs("div", { style: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0
          }, children: [
            /* @__PURE__ */ jsx(LaunchButton, { project, onProjectUpdated: refresh, compact: headerNarrow }),
            project.githubUrl && /* @__PURE__ */ jsx(Btn, { variant: "ghost", icon: "github", onClick: () => window.open(project.githubUrl, "_blank", "noreferrer"), title: "Open GitHub repo", "aria-label": "Open GitHub repo", style: {
              width: 30,
              padding: 0
            } }),
            /* @__PURE__ */ jsx(Btn, { variant: "ghost", icon: "settings", onClick: () => setShowEdit(true), title: `Edit project (${editProjectHotkey})`, "aria-label": `Edit project (${editProjectHotkey})`, style: {
              width: 30,
              padding: 0,
              marginRight: 4
            } }),
            /* @__PURE__ */ jsx(NewAgentButton, { project, onPrimary: onNewAgentPrimary, onConfigure: () => setShowNewAgent(true) })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { style: {
          display: "flex",
          gap: 2,
          marginBottom: 20,
          padding: 3,
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          width: "fit-content"
        }, children: [{
          id: "active",
          label: "Active",
          count: tasks.filter((t) => !t.archived).length
        }, {
          id: "archived",
          label: "Archived",
          count: tasks.filter((t) => t.archived).length
        }].map((tab) => /* @__PURE__ */ jsxs("button", { onClick: () => setFilter(tab.id), "aria-pressed": filter === tab.id, "aria-label": `${tab.label} tasks (${tab.count})`, style: {
          background: filter === tab.id ? "var(--surface-3)" : "transparent",
          border: 0,
          cursor: "pointer",
          padding: "6px 14px",
          borderRadius: 5,
          color: filter === tab.id ? "var(--text)" : "var(--text-dim)",
          fontFamily: "var(--mono)",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6
        }, children: [
          tab.label,
          /* @__PURE__ */ jsx("span", { style: {
            color: "var(--text-faint)",
            fontVariantNumeric: "tabular-nums"
          }, children: tab.count })
        ] }, tab.id)) }),
        filter === "active" ? /* @__PURE__ */ jsxs("div", { style: {
          display: "flex",
          flexDirection: "column",
          gap: 28
        }, children: [
          TASK_STATUSES.map((status) => /* @__PURE__ */ jsx(TaskColumn, { title: STATUS_META[status].label, color: STATUS_META[status].color, tasks: tasksByStatus[status], activeId, onToggle: toggleTerminal, onArchive: archive, onDelete: deleteTask }, status)),
          visibleTasks.length === 0 && /* @__PURE__ */ jsx(EmptyState, { title: "No active tasks", subtitle: "Start a new agent to begin working on this project.", action: /* @__PURE__ */ jsx(NewAgentButton, { project, onPrimary: onNewAgentPrimary, onConfigure: () => setShowNewAgent(true) }) })
        ] }) : /* @__PURE__ */ jsx("div", { style: {
          display: "flex",
          flexDirection: "column",
          gap: 8
        }, children: visibleTasks.length === 0 ? /* @__PURE__ */ jsx(EmptyState, { title: "Nothing archived", subtitle: "Archived tasks will appear here.", icon: "archive" }) : visibleTasks.map((t) => /* @__PURE__ */ jsxs("div", { style: {
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 8
        }, children: [
          /* @__PURE__ */ jsx(AgentGlyph, { agent: t.agent, size: 12 }),
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
              t.branch,
              " · +",
              t.lines,
              " lines · archived"
            ] })
          ] }),
          /* @__PURE__ */ jsx(Btn, { size: "sm", variant: "ghost", onClick: async () => {
            await api.restoreTask(t.id);
            await refresh();
          }, children: "Restore" })
        ] }, t.id)) })
      ] }),
      /* @__PURE__ */ jsx(NewAgentDialog, { open: showNewAgent, project, onClose: () => setShowNewAgent(false), onStart: startAgent, onPersistRemember: async (patch) => {
        await api.updateProject(project.id, patch);
        await refresh();
      } }),
      /* @__PURE__ */ jsx(ProjectDialog, { open: showEdit, project, groups, onClose: () => setShowEdit(false), onSave: async (data) => {
        await api.updateProject(project.id, data);
        setShowEdit(false);
        await refresh();
      }, onDelete: remove }),
      /* @__PURE__ */ jsx(FileFinderDialog, { open: fileFinderOpen, projectRoot: project.path, onClose: () => setFileFinderOpen(false), onPick: (rel) => setOpenFileRel(rel) }),
      /* @__PURE__ */ jsx(FileEditorDialog, { projectRoot: project.path, relPath: openFileRel, onClose: () => setOpenFileRel(null) }),
      /* @__PURE__ */ jsxs(Modal, { open: confirmRemove, onClose: () => setConfirmRemove(false), title: "Remove project", width: 460, footer: /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs(Btn, { variant: "ghost", onClick: () => setConfirmRemove(false), children: [
          "Cancel ",
          /* @__PURE__ */ jsx(Kbd, { variant: "inline", children: "Esc" })
        ] }),
        /* @__PURE__ */ jsx(Btn, { variant: "danger", icon: "trash", onClick: confirmRemoveProject, children: "Remove" })
      ] }), children: [
        /* @__PURE__ */ jsxs("div", { style: {
          fontSize: 13,
          color: "var(--text)",
          marginBottom: 8
        }, children: [
          "Remove “",
          project.name,
          "” from MissionControl?"
        ] }),
        /* @__PURE__ */ jsxs("div", { style: {
          fontSize: 12,
          color: "var(--text-dim)"
        }, children: [
          "This only unlinks the project — the files at ",
          project.path,
          " are not touched."
        ] })
      ] })
    ] })
  ] });
}
export {
  ProjectPage as component
};
