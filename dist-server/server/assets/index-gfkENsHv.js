import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useRouter } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useMemo } from "react";
import { I as Icon, S as ShimmerBar, P as ProjectIcon, b as StatusPill, c as StatusDot, B as Btn, a as api } from "./router-YiALtSFa.js";
import { u as useServerEvents, E as EmptyState } from "./use-events-D3hEWd0y.js";
import { M as Modal, T as TextField, P as ProjectDialog } from "./ProjectDialog-qYivCJla.js";
function Section({
  label,
  count,
  icon,
  dot,
  children
}) {
  return /* @__PURE__ */ jsxs("div", { style: { marginBottom: 32 }, children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
          paddingBottom: 8,
          borderBottom: "1px solid var(--border)"
        },
        children: [
          dot && /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: dot,
                boxShadow: `0 0 6px ${dot}66`
              }
            }
          ),
          icon && /* @__PURE__ */ jsx(Icon, { name: icon, size: 12, style: { color: "var(--accent)" } }),
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
              children: label
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
              children: count
            }
          )
        ]
      }
    ),
    children
  ] });
}
function ProjectCard({
  project,
  density,
  onOpen,
  onTogglePin
}) {
  const { running, needsInput, done } = project.taskCounts;
  const hasActivity = running > 0;
  const isCompact = density === "compact";
  const isSpacious = density === "spacious";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      onClick: onOpen,
      style: {
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, transform 0.15s, background 0.15s",
        display: "flex",
        flexDirection: "column",
        position: "relative"
      },
      onMouseEnter: (e) => {
        e.currentTarget.style.borderColor = "var(--border-strong)";
        e.currentTarget.style.background = "var(--surface-2)";
      },
      onMouseLeave: (e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.background = "var(--surface-1)";
      },
      children: [
        /* @__PURE__ */ jsx(ShimmerBar, { active: hasActivity }),
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              padding: isCompact ? 12 : isSpacious ? 20 : 16,
              display: "flex",
              flexDirection: "column",
              gap: isCompact ? 10 : 14
            },
            children: [
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "flex-start", gap: 12 }, children: [
                /* @__PURE__ */ jsx(ProjectIcon, { project, size: isCompact ? 30 : isSpacious ? 44 : 36 }),
                /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
                  /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }, children: [
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        style: {
                          fontFamily: "var(--mono)",
                          fontSize: isCompact ? 13 : 14,
                          fontWeight: 600,
                          color: "var(--text)",
                          letterSpacing: "-0.01em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        },
                        children: project.name
                      }
                    ),
                    project.pinned && /* @__PURE__ */ jsx(Icon, { name: "pin-fill", size: 10, style: { color: "var(--accent)", flexShrink: 0 } })
                  ] }),
                  /* @__PURE__ */ jsx(
                    "div",
                    {
                      style: {
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--text-faint)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      },
                      children: project.path
                    }
                  )
                ] }),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    onClick: (e) => {
                      e.stopPropagation();
                      onTogglePin(project.id);
                    },
                    style: {
                      background: "transparent",
                      border: 0,
                      padding: 4,
                      cursor: "pointer",
                      color: project.pinned ? "var(--accent)" : "var(--text-faint)",
                      display: "flex"
                    },
                    title: project.pinned ? "Unpin" : "Pin",
                    children: /* @__PURE__ */ jsx(Icon, { name: project.pinned ? "pin-fill" : "pin", size: 12 })
                  }
                )
              ] }),
              !isCompact && /* @__PURE__ */ jsxs(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--text-dim)"
                  },
                  children: [
                    /* @__PURE__ */ jsx(Icon, { name: "git-branch", size: 11, style: { color: "var(--text-faint)" } }),
                    /* @__PURE__ */ jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: project.branch })
                  ]
                }
              ),
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
                running > 0 && /* @__PURE__ */ jsx(StatusPill, { status: "running", count: running }),
                needsInput > 0 && /* @__PURE__ */ jsx(StatusPill, { status: "needs-input", count: needsInput }),
                done > 0 && /* @__PURE__ */ jsx(StatusPill, { status: "done", count: done }),
                running + needsInput + done === 0 && /* @__PURE__ */ jsx("span", { style: { fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }, children: "no active tasks" })
              ] }),
              !isCompact && hasActivity && project.preview && /* @__PURE__ */ jsxs(
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
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: 6
                  },
                  children: [
                    /* @__PURE__ */ jsx(StatusDot, { status: "running" }),
                    /* @__PURE__ */ jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: project.preview })
                  ]
                }
              )
            ]
          }
        )
      ]
    }
  );
}
function GroupsDialog({
  open,
  groups,
  projects,
  onClose,
  onAdd,
  onRemove,
  onRename
}) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null);
  return /* @__PURE__ */ jsx(
    Modal,
    {
      open,
      onClose,
      title: "Manage groups",
      width: 480,
      footer: /* @__PURE__ */ jsx(Btn, { variant: "ghost", onClick: onClose, children: "Done" }),
      children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 14 }, children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
          /* @__PURE__ */ jsx("div", { style: { flex: 1 }, children: /* @__PURE__ */ jsx(TextField, { value: newName, onChange: setNewName, placeholder: "New group name" }) }),
          /* @__PURE__ */ jsx(
            Btn,
            {
              variant: "accent",
              icon: "plus",
              onClick: async () => {
                if (newName.trim()) {
                  await onAdd(newName.trim());
                  setNewName("");
                }
              },
              children: "Add"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
          groups.map((g) => {
            const count = projects.filter((p) => p.groupId === g.id).length;
            const isEditing = editing?.id === g.id;
            return /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: "var(--surface-0)",
                  border: "1px solid var(--border)",
                  borderRadius: 8
                },
                children: [
                  /* @__PURE__ */ jsx(
                    "span",
                    {
                      style: {
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: g.color,
                        boxShadow: `0 0 6px ${g.color}66`
                      }
                    }
                  ),
                  isEditing ? /* @__PURE__ */ jsxs(Fragment, { children: [
                    /* @__PURE__ */ jsx(
                      "input",
                      {
                        autoFocus: true,
                        value: editing.name,
                        onChange: (e) => setEditing({ id: g.id, name: e.target.value }),
                        onKeyDown: async (e) => {
                          if (e.key === "Enter" && editing.name.trim()) {
                            await onRename(g.id, editing.name.trim());
                            setEditing(null);
                          } else if (e.key === "Escape") {
                            setEditing(null);
                          }
                        },
                        style: {
                          flex: 1,
                          background: "var(--surface-1)",
                          border: "1px solid var(--accent)",
                          borderRadius: 5,
                          outline: 0,
                          color: "var(--text)",
                          padding: "4px 8px",
                          fontFamily: "var(--mono)",
                          fontSize: 12.5
                        }
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      Btn,
                      {
                        size: "sm",
                        variant: "accent",
                        onClick: async () => {
                          if (editing.name.trim()) {
                            await onRename(g.id, editing.name.trim());
                            setEditing(null);
                          }
                        },
                        children: "Save"
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        onClick: () => setEditing(null),
                        title: "Cancel",
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
                  ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        onClick: () => setEditing({ id: g.id, name: g.name }),
                        style: {
                          flex: 1,
                          fontFamily: "var(--mono)",
                          fontSize: 12.5,
                          cursor: "pointer"
                        },
                        title: "Click to rename",
                        children: g.name
                      }
                    ),
                    /* @__PURE__ */ jsxs(
                      "span",
                      {
                        style: {
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--text-faint)"
                        },
                        children: [
                          count,
                          " ",
                          count === 1 ? "project" : "projects"
                        ]
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        onClick: () => setEditing({ id: g.id, name: g.name }),
                        title: "Rename",
                        style: {
                          background: "transparent",
                          border: 0,
                          color: "var(--text-faint)",
                          cursor: "pointer",
                          padding: 4,
                          display: "flex"
                        },
                        children: /* @__PURE__ */ jsx(Icon, { name: "settings", size: 12 })
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        onClick: async () => {
                          if (confirm(
                            `Remove group "${g.name}"?

Projects in this group will become ungrouped — they aren't deleted.`
                          )) {
                            await onRemove(g.id);
                          }
                        },
                        title: "Remove group",
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
                  ] })
                ]
              },
              g.id
            );
          }),
          groups.length === 0 && /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                padding: 24,
                textAlign: "center",
                color: "var(--text-faint)",
                fontFamily: "var(--mono)",
                fontSize: 12
              },
              children: "No groups yet"
            }
          )
        ] })
      ] })
    }
  );
}
function MissionControlPage() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [density, setDensity] = useState("regular");
  const [showAdd, setShowAdd] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const refresh = useCallback(async () => {
    const [p, g] = await Promise.all([api.listProjects(), api.listGroups()]);
    setProjects(p.projects);
    setGroups(g.groups);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useServerEvents(useCallback((e) => {
    if (e.type.startsWith("project:") || e.type.startsWith("group:") || e.type.startsWith("task:")) {
      void refresh();
    }
  }, [refresh]));
  const filter = (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.path.toLowerCase().includes(search.toLowerCase());
  const pinned = projects.filter((p) => p.pinned && filter(p));
  const byGroup = groups.map((g) => ({
    group: g,
    projects: projects.filter((p) => p.groupId === g.id && !p.pinned && filter(p))
  })).filter((gr) => gr.projects.length > 0);
  const ungrouped = projects.filter((p) => !p.groupId && !p.pinned && filter(p));
  const gridCols = density === "compact" ? "repeat(auto-fill, minmax(240px, 1fr))" : density === "spacious" ? "repeat(auto-fill, minmax(360px, 1fr))" : "repeat(auto-fill, minmax(300px, 1fr))";
  const totalRunning = projects.reduce((a, p) => a + p.taskCounts.running, 0);
  const totalNeeds = projects.reduce((a, p) => a + p.taskCounts.needsInput, 0);
  const totalDone = projects.reduce((a, p) => a + p.taskCounts.done, 0);
  const dateLabel = useMemo(() => (/* @__PURE__ */ new Date()).toLocaleDateString(void 0, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }), []);
  const open = (id) => router.navigate({
    to: "/projects/$id",
    params: {
      id
    }
  });
  const togglePin = async (id) => {
    await api.togglePin(id);
    await refresh();
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { style: {
      flex: 1,
      overflow: "auto",
      padding: "28px 32px 80px"
    }, className: "dot-grid-bg", children: /* @__PURE__ */ jsxs("div", { style: {
      maxWidth: 1400,
      margin: "0 auto"
    }, children: [
      /* @__PURE__ */ jsxs("div", { style: {
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginBottom: 24,
        gap: 24,
        flexWrap: "wrap"
      }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsxs("div", { style: {
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-faint)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 6
          }, children: [
            "✦ ",
            dateLabel
          ] }),
          /* @__PURE__ */ jsx("h1", { style: {
            margin: 0,
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em"
          }, children: "Mission Control" }),
          /* @__PURE__ */ jsxs("div", { style: {
            display: "flex",
            gap: 16,
            marginTop: 10,
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text-dim)"
          }, children: [
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx(StatusDot, { status: "running" }),
              " ",
              /* @__PURE__ */ jsx("span", { style: {
                color: "var(--text)",
                marginLeft: 6,
                fontVariantNumeric: "tabular-nums"
              }, children: totalRunning }),
              " ",
              "running"
            ] }),
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx(StatusDot, { status: "needs-input" }),
              " ",
              /* @__PURE__ */ jsx("span", { style: {
                color: "var(--text)",
                marginLeft: 6,
                fontVariantNumeric: "tabular-nums"
              }, children: totalNeeds }),
              " ",
              "awaiting input"
            ] }),
            /* @__PURE__ */ jsxs("span", { style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 6
            }, children: [
              /* @__PURE__ */ jsx("span", { style: {
                width: 6,
                height: 6,
                borderRadius: 3,
                background: "var(--status-done)"
              } }),
              /* @__PURE__ */ jsx("span", { style: {
                color: "var(--text)",
                fontVariantNumeric: "tabular-nums"
              }, children: totalDone }),
              " ",
              "ready"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { style: {
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap"
        }, children: [
          /* @__PURE__ */ jsxs("div", { style: {
            display: "flex",
            alignItems: "center",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            padding: "0 10px",
            height: 32,
            width: 220
          }, children: [
            /* @__PURE__ */ jsx(Icon, { name: "search", size: 12, style: {
              color: "var(--text-faint)",
              marginRight: 6
            } }),
            /* @__PURE__ */ jsx("input", { value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search projects…", style: {
              flex: 1,
              background: "transparent",
              border: 0,
              outline: 0,
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 11.5
            } })
          ] }),
          /* @__PURE__ */ jsx("div", { style: {
            display: "flex",
            padding: 2,
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            height: 32
          }, children: ["compact", "regular", "spacious"].map((d) => /* @__PURE__ */ jsx("button", { onClick: () => setDensity(d), title: d, style: {
            background: density === d ? "var(--surface-3)" : "transparent",
            border: 0,
            color: density === d ? "var(--text)" : "var(--text-dim)",
            borderRadius: 5,
            cursor: "pointer",
            padding: "0 10px",
            fontFamily: "var(--mono)",
            fontSize: 11
          }, children: d === "compact" ? "▪" : d === "regular" ? "▪▪" : "▪▪▪" }, d)) }),
          /* @__PURE__ */ jsx(Btn, { variant: "ghost", icon: "group", onClick: () => setShowGroups(true), children: "Groups" }),
          /* @__PURE__ */ jsx(Btn, { variant: "ghost", icon: "archive", onClick: () => router.navigate({
            to: "/archive"
          }), children: "Archive" }),
          /* @__PURE__ */ jsx(Btn, { variant: "primary", icon: "plus", onClick: () => setShowAdd(true), children: "Add project" })
        ] })
      ] }),
      pinned.length > 0 && /* @__PURE__ */ jsx(Section, { label: "Pinned", count: pinned.length, icon: "pin-fill", children: /* @__PURE__ */ jsx("div", { style: {
        display: "grid",
        gridTemplateColumns: gridCols,
        gap: 14
      }, children: pinned.map((p) => /* @__PURE__ */ jsx(ProjectCard, { project: p, density, onOpen: () => open(p.id), onTogglePin: togglePin }, p.id)) }) }),
      byGroup.map(({
        group,
        projects: gp
      }) => /* @__PURE__ */ jsx(Section, { label: group.name, count: gp.length, dot: group.color, children: /* @__PURE__ */ jsx("div", { style: {
        display: "grid",
        gridTemplateColumns: gridCols,
        gap: 14
      }, children: gp.map((p) => /* @__PURE__ */ jsx(ProjectCard, { project: p, density, onOpen: () => open(p.id), onTogglePin: togglePin }, p.id)) }) }, group.id)),
      ungrouped.length > 0 && /* @__PURE__ */ jsx(Section, { label: "Ungrouped", count: ungrouped.length, children: /* @__PURE__ */ jsx("div", { style: {
        display: "grid",
        gridTemplateColumns: gridCols,
        gap: 14
      }, children: ungrouped.map((p) => /* @__PURE__ */ jsx(ProjectCard, { project: p, density, onOpen: () => open(p.id), onTogglePin: togglePin }, p.id)) }) }),
      projects.filter(filter).length === 0 && /* @__PURE__ */ jsx(EmptyState, { title: search ? "No matches" : "No projects yet", subtitle: search ? "Try a different search." : "Add your first project to start running agents.", action: !search && /* @__PURE__ */ jsx(Btn, { variant: "primary", icon: "plus", onClick: () => setShowAdd(true), children: "Add project" }) })
    ] }) }),
    /* @__PURE__ */ jsx(ProjectDialog, { open: showAdd, project: null, groups, onClose: () => setShowAdd(false), onSave: async (data) => {
      await api.createProject(data);
      setShowAdd(false);
      await refresh();
    } }),
    /* @__PURE__ */ jsx(GroupsDialog, { open: showGroups, groups, projects, onClose: () => setShowGroups(false), onAdd: async (name) => {
      await api.createGroup({
        name
      });
      await refresh();
    }, onRemove: async (id) => {
      await api.deleteGroup(id);
      await refresh();
    }, onRename: async (id, name) => {
      await api.updateGroup(id, {
        name
      });
      await refresh();
    } })
  ] });
}
export {
  MissionControlPage as component
};
