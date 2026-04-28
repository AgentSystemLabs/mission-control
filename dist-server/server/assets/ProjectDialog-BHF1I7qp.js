import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useRef, useEffect, useState } from "react";
import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { i as useHotkey, I as Icon, B as Btn, C as ICON_COLORS, K as KbdAction, g as getElectron } from "./router-XpjizlSW.js";
function CursorGlow() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e) => {
      if (e.pointerType === "touch") return;
      el.style.setProperty("--x", `${e.clientX}px`);
      el.style.setProperty("--y", `${e.clientY}px`);
      el.dataset.active = "1";
    };
    const onLeave = () => {
      delete el.dataset.active;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  return /* @__PURE__ */ jsx("div", { ref, className: "cursor-glow", "aria-hidden": true });
}
function useCardGlow() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gx", `${e.clientX - r.left}px`);
      el.style.setProperty("--gy", `${e.clientY - r.top}px`);
    };
    const onEnter = (e) => {
      if (e.pointerType === "touch") return;
      el.dataset.glow = "1";
      document.body.dataset.cardGlow = "1";
    };
    const onLeave = () => {
      delete el.dataset.glow;
      delete document.body.dataset.cardGlow;
    };
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      delete document.body.dataset.cardGlow;
    };
  }, []);
  return ref;
}
const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdAt: integer("created_at").notNull()
});
const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    icon: text("icon").notNull(),
    iconColor: text("icon_color").notNull(),
    imagePath: text("image_path"),
    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    branch: text("branch").notNull().default("main"),
    launchCommands: text("launch_commands"),
    rememberAgentSettings: integer("remember_agent_settings", { mode: "boolean" }).notNull().default(false),
    savedAgent: text("saved_agent").$type(),
    savedSkipPermissions: integer("saved_skip_permissions", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => ({
    groupIdx: index("projects_group_idx").on(t.groupId),
    pinnedIdx: index("projects_pinned_idx").on(t.pinned)
  })
);
const TASK_STATUSES = ["ready", "running", "needs-input", "finished", "terminated"];
const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    agent: text("agent").$type().notNull(),
    status: text("status").$type().notNull().default("ready"),
    branch: text("branch").notNull().default("main"),
    preview: text("preview").notNull().default(""),
    lines: integer("lines").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => ({
    projectIdx: index("tasks_project_idx").on(t.projectId),
    statusIdx: index("tasks_status_idx").on(t.status),
    archivedIdx: index("tasks_archived_idx").on(t.archived)
  })
);
const terminalLogs = sqliteTable(
  "terminal_logs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    chunk: text("chunk").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => ({
    taskIdx: index("terminal_logs_task_idx").on(t.taskId)
  })
);
sqliteTable(
  "user_terminals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cwd: text("cwd"),
    startCommand: text("start_command"),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => ({
    projectIdx: index("user_terminals_project_idx").on(t.projectId)
  })
);
sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull()
});
relations(groups, ({ many }) => ({
  projects: many(projects)
}));
relations(projects, ({ one, many }) => ({
  group: one(groups, { fields: [projects.groupId], references: [groups.id] }),
  tasks: many(tasks)
}));
relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  logs: many(terminalLogs)
}));
relations(terminalLogs, ({ one }) => ({
  task: one(tasks, { fields: [terminalLogs.taskId], references: [tasks.id] })
}));
const LAUNCH_COMMANDS_MAX = 5;
function parseLaunchCommands(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (c) => c && typeof c.id === "string" && typeof c.name === "string" && typeof c.command === "string"
    ).slice(0, LAUNCH_COMMANDS_MAX);
  } catch {
    return [];
  }
}
function Modal({
  open,
  onClose,
  title,
  children,
  width = 480,
  footer
}) {
  useHotkey(
    "escape",
    (e) => {
      e.stopPropagation();
      onClose();
    },
    { enabled: open, preventDefault: false }
  );
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
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
        alignItems: "center",
        justifyContent: "center",
        animation: "fade-up 0.12s ease-out"
      },
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          ref: panelRef,
          tabIndex: -1,
          onClick: (e) => e.stopPropagation(),
          style: {
            width,
            outline: "none",
            maxWidth: "92vw",
            maxHeight: "85vh",
            background: "var(--surface-1)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset",
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
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--border)"
                },
                children: [
                  /* @__PURE__ */ jsx(
                    "div",
                    {
                      style: {
                        fontFamily: "var(--mono)",
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: "0.02em"
                      },
                      children: title
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "button",
                    {
                      type: "button",
                      onClick: onClose,
                      "aria-label": "Close dialog",
                      style: {
                        background: "transparent",
                        border: 0,
                        color: "var(--text-dim)",
                        cursor: "pointer",
                        padding: 4,
                        display: "flex"
                      },
                      children: /* @__PURE__ */ jsx(Icon, { name: "x", size: 13 })
                    }
                  )
                ]
              }
            ),
            /* @__PURE__ */ jsx("div", { style: { padding: 18, overflowY: "auto", flex: 1 }, children }),
            footer && /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  padding: "12px 18px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--surface-0)"
                },
                children: footer
              }
            )
          ]
        }
      )
    }
  );
}
function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
  rightAddon,
  type = "text",
  autoFocus,
  inputRef
}) {
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    label && /* @__PURE__ */ jsx(
      "label",
      {
        style: {
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--text-dim)",
          letterSpacing: "0.05em",
          textTransform: "uppercase"
        },
        children: label
      }
    ),
    /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          overflow: "hidden"
        },
        children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type,
              value,
              onChange: (e) => onChange(e.target.value),
              placeholder,
              autoFocus,
              ref: inputRef,
              style: {
                flex: 1,
                background: "transparent",
                border: 0,
                outline: 0,
                color: "var(--text)",
                padding: "9px 12px",
                fontFamily: mono ? "var(--mono)" : "var(--sans)",
                fontSize: 13
              }
            }
          ),
          rightAddon && /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                padding: "0 10px",
                color: "var(--text-faint)",
                fontFamily: "var(--mono)",
                fontSize: 11
              },
              children: rightAddon
            }
          )
        ]
      }
    ),
    hint && /* @__PURE__ */ jsx("div", { style: { fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }, children: hint })
  ] });
}
function ProjectDialog({
  open,
  project,
  groups: groups2,
  onClose,
  onSave,
  onDelete
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [groupId, setGroupId] = useState("");
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("#7ce58a");
  const [imagePath, setImagePath] = useState(null);
  const [imageVersion, setImageVersion] = useState(0);
  const [pendingImage, setPendingImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);
  useEffect(() => {
    if (open) {
      nameRef.current?.focus();
      nameRef.current?.select();
      setName(project?.name || "");
      setPath(project?.path || "");
      setGroupId(project?.groupId || "");
      setIcon(project?.icon || "");
      setIconColor(project?.iconColor || "#7ce58a");
      setImagePath(project?.imagePath ?? null);
      setImageVersion(project?.updatedAt ?? 0);
      setPendingImage(null);
      setError(null);
    }
  }, [open, project]);
  const chooseImage = async () => {
    setError(null);
    const electron = getElectron();
    if (!electron) return;
    const picked = await electron.pickImage();
    if (!picked) return;
    if ("error" in picked) {
      setError(picked.error);
      return;
    }
    if (!project) {
      setPendingImage(picked);
      return;
    }
    setUploading(true);
    try {
      const result = await electron.saveProjectImage({
        projectId: project.id,
        sourcePath: picked.sourcePath,
        extension: picked.extension
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setImagePath(result.filename);
      setImageVersion(Date.now());
    } finally {
      setUploading(false);
    }
  };
  const removeImage = () => {
    setImagePath(null);
    setPendingImage(null);
    setImageVersion(Date.now());
  };
  const browse = async () => {
    const electron = getElectron();
    if (!electron) return;
    const result = await electron.browseFolder();
    if (result) {
      setPath(result);
      if (!name.trim()) {
        const basename = result.split(/[\\/]/).filter(Boolean).pop() || "";
        if (basename) setName(basename);
      }
    }
  };
  const submit = async () => {
    setError(null);
    try {
      const effectiveName = name.trim() || (path.trim().split(/[\\/]/).filter(Boolean).pop() ?? "");
      await onSave({
        name: name.trim() || void 0,
        path,
        icon: icon || effectiveName.slice(0, 2).toUpperCase(),
        iconColor,
        groupId: groupId || null,
        ...project ? { imagePath } : { pendingImage }
      });
    } catch (e) {
      setError(e?.message || "Save failed");
    }
  };
  useHotkey("dialog.submit", () => void submit(), { enabled: open });
  return /* @__PURE__ */ jsx(
    Modal,
    {
      open,
      onClose,
      title: project ? "Edit project" : "Add project",
      width: 520,
      footer: /* @__PURE__ */ jsxs(Fragment, { children: [
        project && onDelete && /* @__PURE__ */ jsx(
          Btn,
          {
            variant: "danger",
            icon: "trash",
            onClick: async () => {
              await onDelete();
            },
            style: { marginRight: "auto" },
            children: "Remove project"
          }
        ),
        /* @__PURE__ */ jsx(Btn, { variant: "ghost", onClick: onClose, children: "Cancel" }),
        /* @__PURE__ */ jsxs(Btn, { variant: "primary", onClick: submit, children: [
          project ? "Save" : "Add project",
          /* @__PURE__ */ jsx(KbdAction, { action: "dialog.submit", variant: "onPrimary" })
        ] })
      ] }),
      children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 18 }, children: [
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: "Name (optional — defaults to folder name)",
            value: name,
            onChange: setName,
            inputRef: nameRef,
            placeholder: path.trim().split(/[\\/]/).filter(Boolean).pop() || "my-project"
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
                marginBottom: 6
              },
              children: "Working directory"
            }
          ),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
            /* @__PURE__ */ jsx("div", { style: { flex: 1 }, children: /* @__PURE__ */ jsx(TextField, { mono: true, value: path, onChange: setPath, placeholder: "/Users/me/dev/my-project" }) }),
            /* @__PURE__ */ jsx(Btn, { variant: "solid", icon: "folder", onClick: browse, children: "Browse…" })
          ] })
        ] }),
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
                marginBottom: 6
              },
              children: "Custom image"
            }
          ),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsx(Btn, { variant: "solid", icon: "folder", onClick: chooseImage, disabled: uploading, children: uploading ? "Uploading…" : imagePath || pendingImage ? "Replace image…" : "Choose image…" }),
            (imagePath || pendingImage) && /* @__PURE__ */ jsx(Btn, { variant: "ghost", onClick: removeImage, children: "Remove" }),
            pendingImage && /* @__PURE__ */ jsxs(
              "span",
              {
                style: {
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)"
                },
                children: [
                  pendingImage.sourcePath.split(/[\\/]/).pop(),
                  " — uploads on save"
                ]
              }
            ),
            /* @__PURE__ */ jsx(
              "span",
              {
                style: {
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-faint)"
                },
                children: "PNG / JPG / WebP / GIF, ≤ 5MB"
              }
            )
          ] })
        ] }),
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
                marginBottom: 6
              },
              children: "Icon (fallback)"
            }
          ),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 10, alignItems: "center" }, children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                value: icon,
                onChange: (e) => setIcon(e.target.value.slice(0, 2).toUpperCase()),
                maxLength: 2,
                placeholder: "AB",
                style: {
                  width: 60,
                  textAlign: "center",
                  background: "var(--surface-0)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  outline: 0,
                  color: "var(--text)",
                  padding: "9px 8px",
                  fontFamily: "var(--mono)",
                  fontSize: 14,
                  fontWeight: 600
                }
              }
            ),
            /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: ICON_COLORS.map((c) => /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => setIconColor(c),
                style: {
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: c,
                  border: iconColor === c ? "2px solid var(--text)" : "2px solid transparent",
                  cursor: "pointer"
                }
              },
              c
            )) })
          ] })
        ] }),
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
                marginBottom: 6
              },
              children: "Group"
            }
          ),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => setGroupId(""),
                style: {
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: groupId === "" ? "var(--accent-dim)" : "var(--surface-0)",
                  border: `1px solid ${groupId === "" ? "var(--accent)" : "var(--border)"}`,
                  color: groupId === "" ? "var(--accent)" : "var(--text-dim)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  cursor: "pointer"
                },
                children: "Ungrouped"
              }
            ),
            groups2.map((g) => /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: () => setGroupId(g.id),
                style: {
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: groupId === g.id ? "var(--accent-dim)" : "var(--surface-0)",
                  border: `1px solid ${groupId === g.id ? "var(--accent)" : "var(--border)"}`,
                  color: groupId === g.id ? "var(--accent)" : "var(--text-dim)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6
                },
                children: [
                  /* @__PURE__ */ jsx("span", { style: { width: 7, height: 7, borderRadius: "50%", background: g.color } }),
                  g.name
                ]
              },
              g.id
            ))
          ] })
        ] }),
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
export {
  CursorGlow as C,
  LAUNCH_COMMANDS_MAX as L,
  Modal as M,
  ProjectDialog as P,
  TASK_STATUSES as T,
  TextField as a,
  parseLaunchCommands as p,
  useCardGlow as u
};
