import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useRouter } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { A as AGENT_META, d as STATUS_META, S as ShimmerBar, c as StatusDot, I as Icon, B as Btn, g as getElectron, R as Route, u as useTerminals, a as api, P as ProjectIcon } from "./router-YiALtSFa.js";
import { u as useServerEvents, E as EmptyState } from "./use-events-D3hEWd0y.js";
import { M as Modal, T as TextField, P as ProjectDialog } from "./ProjectDialog-qYivCJla.js";
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
function TaskCard({
  task,
  selected,
  onToggle,
  onArchive,
  onCommitPush
}) {
  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";
  const updated = formatRelative(task.updatedAt);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      onClick: () => onToggle(task.id),
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
        if (!selected) e.currentTarget.style.borderColor = "var(--border-strong)";
      },
      onMouseLeave: (e) => {
        if (!selected) e.currentTarget.style.borderColor = "var(--border)";
      },
      children: [
        /* @__PURE__ */ jsx(ShimmerBar, { active: isRunning, color: meta?.color }),
        /* @__PURE__ */ jsxs("div", { style: { padding: 14, display: "flex", flexDirection: "column", gap: 10 }, children: [
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
              /* @__PURE__ */ jsx(
                "div",
                {
                  style: {
                    fontSize: 13.5,
                    fontWeight: 500,
                    lineHeight: 1.35,
                    color: "var(--text)",
                    marginBottom: 4
                  },
                  children: task.title
                }
              ),
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
            /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }, children: /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: selected ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
                  background: selected ? "var(--accent)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#0a0b0d"
                },
                children: selected && /* @__PURE__ */ jsx(Icon, { name: "check", size: 11 })
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
          task.status === "done" && /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6 }, children: [
            onCommitPush && /* @__PURE__ */ jsx(
              Btn,
              {
                size: "sm",
                variant: "accent",
                icon: "upload",
                onClick: (e) => {
                  e.stopPropagation();
                  onCommitPush(task.id);
                },
                children: "Commit & push"
              }
            ),
            /* @__PURE__ */ jsx(
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
            )
          ] }),
          task.status === "needs-input" && /* @__PURE__ */ jsx(
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
          )
        ] })
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
  selectedSet,
  onToggle,
  onArchive,
  onCommitPush
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
            selected: selectedSet.has(t.id),
            onToggle,
            onArchive,
            onCommitPush
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
  onStart
}) {
  const [agent, setAgent] = useState("claude-code");
  const [title, setTitle] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setAgent("claude-code");
      setTitle("");
      setBranch("");
      setError(null);
    }
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
    },
    {
      id: "shell",
      label: "Shell",
      desc: "Plain interactive shell in this project's directory.",
      cmd: "$SHELL"
    }
  ];
  const submit = async () => {
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
          return;
        }
      }
    }
    try {
      await onStart({
        agent,
        title: title.trim() || "Untitled task",
        branch: branch.trim() || project?.branch || "main"
      });
    } catch (e) {
      setError(e?.message || "Failed to start agent");
    }
  };
  return /* @__PURE__ */ jsx(
    Modal,
    {
      open,
      onClose,
      title: "Start a new agent",
      width: 540,
      footer: /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(Btn, { variant: "ghost", onClick: onClose, children: "Cancel" }),
        /* @__PURE__ */ jsx(Btn, { variant: "primary", icon: "play", onClick: submit, children: "Start agent" })
      ] }),
      children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 18 }, children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--text-dim)"
            },
            children: [
              /* @__PURE__ */ jsx(Icon, { name: "folder", size: 12, style: { color: "var(--text-faint)" } }),
              /* @__PURE__ */ jsx("span", { children: "cd" }),
              /* @__PURE__ */ jsx("span", { style: { color: "var(--text)" }, children: project?.path })
            ]
          }
        ),
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
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: "Task title",
            value: title,
            onChange: setTitle,
            placeholder: "Add streaming support to SSE transport"
          }
        ),
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: "Git branch",
            mono: true,
            value: branch,
            onChange: setBranch,
            placeholder: project?.branch || "main"
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
function ProjectPage() {
  const {
    id
  } = Route.useParams();
  const router = useRouter();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filter, setFilter] = useState("active");
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [apiToken, setApiToken] = useState(null);
  const terminals = useTerminals();
  const refresh = useCallback(async () => {
    try {
      const [pr, ts, gs, st] = await Promise.all([api.getProject(id), api.listTasks(id), api.listGroups(), api.getSettings()]);
      setProject(pr.project);
      setTasks(ts.tasks);
      setGroups(gs.groups);
      setApiToken(st.apiToken);
    } catch {
      router.navigate({
        to: "/"
      });
    }
  }, [id, router]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useServerEvents(useCallback((e) => {
    if (e.type.startsWith("task:") || e.type.startsWith("project:")) void refresh();
  }, [refresh]));
  if (!project) {
    return /* @__PURE__ */ jsx("div", { style: {
      flex: 1,
      padding: 32,
      color: "var(--text-dim)",
      fontFamily: "var(--mono)",
      fontSize: 12
    }, children: "Loading…" });
  }
  const visibleTasks = tasks.filter((t) => filter === "archived" ? t.archived : !t.archived);
  const running = visibleTasks.filter((t) => t.status === "running");
  const needs = visibleTasks.filter((t) => t.status === "needs-input");
  const done = visibleTasks.filter((t) => t.status === "done");
  const selectedSet = new Set(terminals.open.map((t) => t.taskId));
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
  const commitPush = async (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (!terminals.isOpen(taskId)) {
      terminals.toggle(project, task);
      await new Promise((r) => setTimeout(r, 250));
    }
    const safeMsg = task.title.replace(/'/g, "'\\''");
    const cmd = `git add -A && git commit -m '${safeMsg}' && git push`;
    await terminals.runIn(taskId, cmd);
  };
  const remove = async () => {
    if (!confirm(`Remove "${project.name}" from MissionControl?

This only unlinks the project — the files at ${project.path} are not touched.`)) {
      return;
    }
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
    terminals.toggle(project, created.task);
  };
  return /* @__PURE__ */ jsxs("div", { style: {
    flex: 1,
    overflow: "auto",
    padding: "24px 32px 80px"
  }, className: "dot-grid-bg", children: [
    /* @__PURE__ */ jsxs("div", { style: {
      maxWidth: 1100,
      margin: "0 auto"
    }, children: [
      /* @__PURE__ */ jsxs("div", { style: {
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginBottom: 24,
        paddingBottom: 20,
        borderBottom: "1px solid var(--border)"
      }, children: [
        /* @__PURE__ */ jsx(ProjectIcon, { project, size: 52 }),
        /* @__PURE__ */ jsxs("div", { style: {
          flex: 1,
          minWidth: 0
        }, children: [
          /* @__PURE__ */ jsxs("div", { style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4
          }, children: [
            /* @__PURE__ */ jsx("h1", { style: {
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.015em"
            }, children: project.name }),
            project.pinned && /* @__PURE__ */ jsx(Icon, { name: "pin-fill", size: 13, style: {
              color: "var(--accent)"
            } })
          ] }),
          /* @__PURE__ */ jsxs("div", { style: {
            display: "flex",
            gap: 14,
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text-dim)"
          }, children: [
            /* @__PURE__ */ jsx("span", { children: project.path }),
            /* @__PURE__ */ jsx("span", { children: "·" }),
            /* @__PURE__ */ jsxs("span", { style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 5
            }, children: [
              /* @__PURE__ */ jsx(Icon, { name: "git-branch", size: 11 }),
              " ",
              project.branch
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx(Btn, { variant: "ghost", icon: "settings", onClick: () => setShowEdit(true), children: "Edit" }),
        /* @__PURE__ */ jsx(Btn, { variant: "primary", icon: "plus", onClick: () => setShowNewAgent(true), children: "New agent" })
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
      }].map((tab) => /* @__PURE__ */ jsxs("button", { onClick: () => setFilter(tab.id), style: {
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
        /* @__PURE__ */ jsx(TaskColumn, { title: "Needs input", color: "var(--status-needs)", tasks: needs, selectedSet, onToggle: toggleTerminal, onArchive: archive, onCommitPush: commitPush }),
        /* @__PURE__ */ jsx(TaskColumn, { title: "Running", color: "var(--status-running)", tasks: running, selectedSet, onToggle: toggleTerminal, onArchive: archive, onCommitPush: commitPush }),
        /* @__PURE__ */ jsx(TaskColumn, { title: "Done", color: "var(--status-done)", tasks: done, selectedSet, onToggle: toggleTerminal, onArchive: archive, onCommitPush: commitPush }),
        visibleTasks.length === 0 && /* @__PURE__ */ jsx(EmptyState, { title: "No active tasks", subtitle: "Start a new agent to begin working on this project.", action: /* @__PURE__ */ jsx(Btn, { variant: "primary", icon: "plus", onClick: () => setShowNewAgent(true), children: "New agent" }) })
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
    /* @__PURE__ */ jsx(NewAgentDialog, { open: showNewAgent, project, onClose: () => setShowNewAgent(false), onStart: startAgent }),
    /* @__PURE__ */ jsx(ProjectDialog, { open: showEdit, project, groups, onClose: () => setShowEdit(false), onSave: async (data) => {
      await api.updateProject(project.id, data);
      setShowEdit(false);
      await refresh();
    }, onDelete: remove })
  ] });
}
export {
  ProjectPage as component
};
