import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { I as Icon, P as ProjectIcon, B as Btn, e as ICON_COLORS, g as getElectron } from "./router-YiALtSFa.js";
function Modal({
  open,
  onClose,
  title,
  children,
  width = 480,
  footer
}) {
  if (!open) return null;
  return /* @__PURE__ */ jsx(
    "div",
    {
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
          onClick: (e) => e.stopPropagation(),
          style: {
            width,
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
                      onClick: onClose,
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
  type = "text"
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
  groups,
  onClose,
  onSave,
  onDelete
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [groupId, setGroupId] = useState("");
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("#7ce58a");
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setName(project?.name || "");
      setPath(project?.path || "");
      setGroupId(project?.groupId || "");
      setIcon(project?.icon || "");
      setIconColor(project?.iconColor || "#7ce58a");
      setError(null);
    }
  }, [open, project]);
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
        groupId: groupId || null
      });
    } catch (e) {
      setError(e?.message || "Save failed");
    }
  };
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
        /* @__PURE__ */ jsx(Btn, { variant: "primary", onClick: submit, children: project ? "Save" : "Add project" })
      ] }),
      children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 18 }, children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: 14,
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 8
            },
            children: [
              /* @__PURE__ */ jsx(
                ProjectIcon,
                {
                  project: {
                    icon: (icon || name.slice(0, 2) || "??").toUpperCase().slice(0, 2),
                    iconColor
                  },
                  size: 44
                }
              ),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("div", { style: { fontSize: 14, fontWeight: 600 }, children: name || "Project name" }),
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--text-faint)",
                      marginTop: 2
                    },
                    children: path || "~/path/to/project"
                  }
                )
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: "Name (optional — defaults to folder name)",
            value: name,
            onChange: setName,
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
              children: "Icon"
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
            groups.map((g) => /* @__PURE__ */ jsxs(
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
  Modal as M,
  ProjectDialog as P,
  TextField as T
};
