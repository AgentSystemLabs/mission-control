// app.jsx — main app: state, routing, views that weren't in views.jsx

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "regular",
  "accent": "#7ce58a",
  "activity": "shimmer"
}/*EDITMODE-END*/;

// ── Project detail view ─────────────────────────────────────────────────────
const ProjectView = ({ state, dispatch, project }) => {
  const [filter, setFilter] = React.useState("active"); // active | all | archived

  const visibleTasks = project.tasks.filter(t => {
    if (t.archived) return filter === "archived";
    if (filter === "archived") return false;
    return true;
  });

  const running = visibleTasks.filter(t => t.status === "running");
  const needs = visibleTasks.filter(t => t.status === "needs-input");
  const done = visibleTasks.filter(t => t.status === "done");

  const toggleTask = (taskId) => dispatch({ type: "toggle-terminal", projectId: project.id, taskId });
  const archiveTask = (taskId) => dispatch({ type: "archive-task", projectId: project.id, taskId });

  const selectedSet = new Set(state.openTerminals.filter(t => t.projectId === project.id).map(t => t.taskId));

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 32px 80px" }} className="dot-grid-bg">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Project header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          marginBottom: 24, paddingBottom: 20,
          borderBottom: "1px solid var(--border)",
        }}>
          <ProjectIcon project={project} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em" }}>
                {project.name}
              </h1>
              {project.pinned && <Icon name="pin-fill" size={13} style={{ color: "var(--accent)" }} />}
            </div>
            <div style={{ display: "flex", gap: 14, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
              <span>{project.path}</span>
              <span>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="git-branch" size={11} /> {project.branch}
              </span>
            </div>
          </div>
          <Btn variant="ghost" icon="settings" onClick={() => dispatch({ type: "open-edit-project", projectId: project.id })}>
            Edit
          </Btn>
          <Btn variant="primary" icon="plus" onClick={() => dispatch({ type: "open-new-agent", projectId: project.id })}>
            New agent
          </Btn>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 2, marginBottom: 20, padding: 3,
          background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, width: "fit-content" }}>
          {[
            { id: "active", label: "Active", count: project.tasks.filter(t => !t.archived).length },
            { id: "archived", label: "Archived", count: project.tasks.filter(t => t.archived).length },
          ].map(tab => (
            <button key={tab.id} onClick={() => setFilter(tab.id)}
              style={{
                background: filter === tab.id ? "var(--surface-3)" : "transparent",
                border: 0, cursor: "pointer",
                padding: "6px 14px", borderRadius: 5,
                color: filter === tab.id ? "var(--text)" : "var(--text-dim)",
                fontFamily: "var(--mono)", fontSize: 12,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {tab.label}
              <span style={{ color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Task columns */}
        {filter !== "archived" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <TaskColumn title="Needs input" color="var(--status-needs)" tasks={needs}
              selectedSet={selectedSet} onToggle={toggleTask} onArchive={archiveTask} />
            <TaskColumn title="Running" color="var(--status-running)" tasks={running}
              selectedSet={selectedSet} onToggle={toggleTask} onArchive={archiveTask} />
            <TaskColumn title="Done" color="var(--status-done)" tasks={done}
              selectedSet={selectedSet} onToggle={toggleTask} onArchive={archiveTask} />
            {visibleTasks.length === 0 && (
              <EmptyState
                title="No active tasks"
                subtitle="Start a new agent to begin working on this project."
                action={<Btn variant="primary" icon="plus" onClick={() => dispatch({ type: "open-new-agent", projectId: project.id })}>New agent</Btn>}
              />
            )}
          </div>
        )}
        {filter === "archived" && (
          <ArchiveList tasks={project.tasks.filter(t => t.archived)} onRestore={(id) => dispatch({ type: "restore-task", projectId: project.id, taskId: id })} />
        )}
      </div>
    </div>
  );
};

const TaskColumn = ({ title, color, tasks, selectedSet, onToggle, onArchive }) => {
  if (tasks.length === 0) return null;
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}66` }} />
        <span style={{
          fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text)",
        }}>{title}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
          {tasks.length}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
        {tasks.map(t => (
          <TaskCard key={t.id} task={t} selected={selectedSet.has(t.id)} onToggle={onToggle} onArchive={onArchive} />
        ))}
      </div>
    </div>
  );
};

const ArchiveList = ({ tasks, onRestore }) => {
  if (tasks.length === 0) {
    return <EmptyState title="Nothing archived" subtitle="Archived tasks will appear here." icon="archive" />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {tasks.map(t => (
        <div key={t.id} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 14px",
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}>
          <AgentGlyph agent={t.agent} size={12} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--text)" }}>{t.title}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}>
              {t.branch} · +{t.lines} lines · archived
            </div>
          </div>
          <Btn size="sm" variant="ghost" onClick={() => onRestore(t.id)}>Restore</Btn>
        </div>
      ))}
    </div>
  );
};

// ── Terminal Panel ──────────────────────────────────────────────────────────
const TerminalPanel = ({ state, dispatch, projects }) => {
  const open = state.openTerminals;
  if (open.length === 0) return null;

  return (
    <div style={{
      width: 520,
      minWidth: 380,
      background: "#050607",
      borderLeft: "1px solid var(--border-strong)",
      display: "flex", flexDirection: "column",
      flexShrink: 0,
      animation: "slide-right 0.2s ease-out",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-0)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="terminal" size={13} style={{ color: "var(--accent)" }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.02em" }}>
            Terminals
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
            {open.length}
          </span>
        </div>
        <button onClick={() => dispatch({ type: "close-all-terminals" })}
          style={{
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text-dim)", padding: "3px 8px",
            borderRadius: 5, cursor: "pointer",
            fontFamily: "var(--mono)", fontSize: 10.5,
            display: "inline-flex", alignItems: "center", gap: 5,
          }}
        >
          <Icon name="x" size={10} /> Close all
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {open.map((t, i) => {
          const project = projects.find(p => p.id === t.projectId);
          const task = project?.tasks.find(task => task.id === t.taskId);
          if (!task) return null;
          return (
            <TerminalPane
              key={t.taskId}
              project={project}
              task={task}
              flex={1 / open.length}
              isLast={i === open.length - 1}
              onClose={() => dispatch({ type: "toggle-terminal", projectId: t.projectId, taskId: t.taskId })}
            />
          );
        })}
      </div>
    </div>
  );
};

const TerminalPane = ({ project, task, onClose, isLast }) => {
  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";
  const scrollRef = React.useRef(null);

  // Fake transcript
  const lines = React.useMemo(() => makeTranscript(task), [task.id]);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  return (
    <div style={{
      flex: 1, minHeight: 120,
      display: "flex", flexDirection: "column",
      borderBottom: isLast ? "none" : "1px solid var(--border)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px",
        background: "var(--surface-1)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <StatusDot status={task.status} size={7} />
        <ProjectIcon project={project} size={20} />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{
            fontFamily: "var(--mono)", fontSize: 11.5, fontWeight: 500,
            color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {task.title}
          </div>
          <div style={{ display: "flex", gap: 8, fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-faint)", marginTop: 1 }}>
            <span style={{ color: meta.color }}>{meta.glyph} {meta.label}</span>
            <span>·</span>
            <span>{project.name}</span>
            <span>·</span>
            <span style={{ color: statusMeta.color }}>{statusMeta.label}</span>
          </div>
        </div>
        <button onClick={onClose}
          style={{
            background: "transparent", border: 0, padding: 4,
            color: "var(--text-faint)", cursor: "pointer", display: "flex",
          }}
          title="Close"
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <ShimmerBar active={isRunning} color={meta.color} />

      {/* Transcript */}
      <div ref={scrollRef} style={{
        flex: 1,
        overflow: "auto",
        background: "#050607",
        padding: "10px 14px",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        lineHeight: 1.55,
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.color, marginBottom: 1, whiteSpace: "pre-wrap" }}>
            {l.prefix && <span style={{ color: "var(--text-faint)", marginRight: 8 }}>{l.prefix}</span>}
            {l.text}
          </div>
        ))}
        {isRunning && (
          <div style={{ color: meta.color, marginTop: 4 }}>
            <span style={{ color: "var(--text-faint)", marginRight: 8 }}>$</span>
            <span style={{ animation: "caret 1s infinite" }}>▊</span>
          </div>
        )}
      </div>

      {/* Prompt */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 14px",
        background: "var(--surface-0)",
        borderTop: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <span style={{ color: meta.color, fontFamily: "var(--mono)", fontSize: 11.5 }}>
          {meta.glyph}
        </span>
        <input
          placeholder={task.status === "needs-input" ? "Reply to the agent…" : "Type to interrupt…"}
          style={{
            flex: 1, background: "transparent", border: 0, outline: 0,
            color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5,
          }}
        />
        <span style={{
          fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-faint)",
          padding: "1px 5px", border: "1px solid var(--border)", borderRadius: 4,
        }}>⏎</span>
      </div>
    </div>
  );
};

const makeTranscript = (task) => {
  const meta = AGENT_META[task.agent];
  const base = [
    { prefix: "$", text: `${task.agent} --resume`, color: "var(--text-dim)" },
    { text: `session resumed · ${task.branch} · +${task.lines} lines`, color: "var(--text-faint)" },
    { text: "", color: "" },
    { prefix: "user", text: "Continue from where you left off.", color: "var(--text)" },
    { text: "", color: "" },
    { prefix: meta.glyph, text: "Let me check the current state of the changes…", color: meta.color },
    { text: "  ▸ reading src/tools/dispatcher.ts", color: "var(--text-faint)" },
    { text: "  ▸ reading src/tools/registry.ts", color: "var(--text-faint)" },
    { text: "  ▸ running tests: pnpm test", color: "var(--text-faint)" },
  ];
  if (task.status === "running") {
    base.push({ prefix: meta.glyph, text: task.preview, color: meta.color });
  } else if (task.status === "needs-input") {
    base.push({ prefix: meta.glyph, text: task.preview, color: "var(--status-needs)" });
    base.push({ text: "  (waiting for your response…)", color: "var(--text-faint)" });
  } else if (task.status === "done") {
    base.push({ prefix: meta.glyph, text: task.preview, color: meta.color });
    base.push({ text: "✓ all tests passing", color: "var(--status-running)" });
    base.push({ text: "✓ ready to commit", color: "var(--status-done)" });
  }
  return base;
};

// ── Archive view (global) ───────────────────────────────────────────────────
const ArchiveView = ({ state, dispatch }) => {
  const archived = [];
  state.projects.forEach(p => {
    p.tasks.forEach(t => {
      if (t.archived) archived.push({ ...t, project: p });
    });
  });

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }} className="dot-grid-bg">
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>Archive</h1>
        <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)", marginBottom: 24 }}>
          {archived.length} archived {archived.length === 1 ? "task" : "tasks"}
        </div>
        {archived.length === 0 ? (
          <EmptyState title="Nothing archived" subtitle="Completed tasks you archive will show up here." icon="archive" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {archived.map(t => (
              <div key={t.id} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 16px",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}>
                <ProjectIcon project={t.project} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--text)" }}>{t.title}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}>
                    {t.project.name} · {t.branch} · +{t.lines} lines
                  </div>
                </div>
                <Btn size="sm" variant="ghost"
                  onClick={() => dispatch({ type: "restore-task", projectId: t.project.id, taskId: t.id })}>
                  Restore
                </Btn>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Add/Edit Project dialog ─────────────────────────────────────────────────
const ProjectDialog = ({ open, project, groups, onClose, onSave }) => {
  const [name, setName] = React.useState("");
  const [path, setPath] = React.useState("");
  const [groupId, setGroupId] = React.useState("");
  const [icon, setIcon] = React.useState("");
  const [iconColor, setIconColor] = React.useState("#7ce58a");

  React.useEffect(() => {
    if (open) {
      setName(project?.name || "");
      setPath(project?.path || "");
      setGroupId(project?.groupId || "");
      setIcon(project?.icon || "");
      setIconColor(project?.iconColor || "#7ce58a");
    }
  }, [open, project]);

  const colors = ["#7ce58a", "#8ab4ff", "#c792ea", "#fbbf24", "#f472b6", "#34d399", "#fb923c"];

  return (
    <Modal
      open={open} onClose={onClose}
      title={project ? "Edit project" : "Add project"}
      width={520}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary"
            onClick={() => onSave({ name, path, groupId: groupId || null, icon: (icon || name.slice(0, 2)).toUpperCase(), iconColor })}>
            {project ? "Save" : "Add project"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Preview */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14,
          background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <ProjectIcon project={{ icon: (icon || name.slice(0, 2) || "??").toUpperCase(), iconColor }} size={44} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{name || "Project name"}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
              {path || "~/path/to/project"}
            </div>
          </div>
        </div>

        <TextField label="Name" value={name} onChange={setName} placeholder="my-project" />
        <TextField label="Working directory" mono value={path} onChange={setPath} placeholder="~/dev/my-project"
          rightAddon="Browse…" />

        <div>
          <label style={{
            fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500,
            color: "var(--text-dim)", letterSpacing: "0.05em", textTransform: "uppercase",
            display: "block", marginBottom: 6,
          }}>Icon</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 2).toUpperCase())}
              maxLength={2}
              placeholder="AB"
              style={{
                width: 60, textAlign: "center",
                background: "var(--surface-0)", border: "1px solid var(--border)",
                borderRadius: 7, outline: 0, color: "var(--text)",
                padding: "9px 8px", fontFamily: "var(--mono)", fontSize: 14, fontWeight: 600,
              }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {colors.map(c => (
                <button key={c} onClick={() => setIconColor(c)}
                  style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: c,
                    border: iconColor === c ? "2px solid var(--text)" : "2px solid transparent",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
            <button
              style={{
                marginLeft: "auto",
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "var(--surface-0)", border: "1px dashed var(--border-strong)",
                color: "var(--text-dim)", padding: "8px 12px", borderRadius: 7,
                fontFamily: "var(--mono)", fontSize: 11, cursor: "pointer",
              }}
            >
              <Icon name="upload" size={11} /> Upload image
            </button>
          </div>
        </div>

        <div>
          <label style={{
            fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500,
            color: "var(--text-dim)", letterSpacing: "0.05em", textTransform: "uppercase",
            display: "block", marginBottom: 6,
          }}>Group</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setGroupId("")}
              style={{
                padding: "6px 12px", borderRadius: 999,
                background: groupId === "" ? "var(--accent-dim)" : "var(--surface-0)",
                border: `1px solid ${groupId === "" ? "var(--accent)" : "var(--border)"}`,
                color: groupId === "" ? "var(--accent)" : "var(--text-dim)",
                fontFamily: "var(--mono)", fontSize: 11, cursor: "pointer",
              }}
            >Ungrouped</button>
            {groups.map(g => (
              <button key={g.id} onClick={() => setGroupId(g.id)}
                style={{
                  padding: "6px 12px", borderRadius: 999,
                  background: groupId === g.id ? "var(--accent-dim)" : "var(--surface-0)",
                  border: `1px solid ${groupId === g.id ? "var(--accent)" : "var(--border)"}`,
                  color: groupId === g.id ? "var(--accent)" : "var(--text-dim)",
                  fontFamily: "var(--mono)", fontSize: 11, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.color }} />
                {g.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ── Groups dialog ───────────────────────────────────────────────────────────
const GroupsDialog = ({ open, groups, projects, onClose, onAdd, onRename, onRemove }) => {
  const [newName, setNewName] = React.useState("");

  return (
    <Modal open={open} onClose={onClose} title="Manage groups" width={480}
      footer={<Btn variant="ghost" onClick={onClose}>Done</Btn>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <TextField value={newName} onChange={setNewName} placeholder="New group name" />
          </div>
          <Btn variant="accent" icon="plus" onClick={() => { if (newName.trim()) { onAdd(newName.trim()); setNewName(""); } }}>
            Add
          </Btn>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {groups.map(g => {
            const count = projects.filter(p => p.groupId === g.id).length;
            return (
              <div key={g.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px",
                background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8,
              }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: g.color, boxShadow: `0 0 6px ${g.color}66` }} />
                <span style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12.5 }}>{g.name}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
                  {count} {count === 1 ? "project" : "projects"}
                </span>
                <button onClick={() => onRemove(g.id)}
                  style={{
                    background: "transparent", border: 0, color: "var(--text-faint)",
                    cursor: "pointer", padding: 4, display: "flex",
                  }}
                  title="Remove group"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
          {groups.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-faint)", fontFamily: "var(--mono)", fontSize: 12 }}>
              No groups yet
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

// ── New Agent picker ────────────────────────────────────────────────────────
const NewAgentDialog = ({ open, project, onClose, onStart }) => {
  const [agent, setAgent] = React.useState("claude-code");
  const [title, setTitle] = React.useState("");
  const [branch, setBranch] = React.useState("");

  React.useEffect(() => {
    if (open) { setAgent("claude-code"); setTitle(""); setBranch(""); }
  }, [open]);

  const agents = [
    { id: "claude-code", label: "Claude Code", desc: "Anthropic's agentic coder. Best for multi-file refactors and reasoning.", cmd: "claude code" },
    { id: "codex", label: "Codex", desc: "OpenAI's terminal coder. Best for test-driven, narrow tasks.", cmd: "codex" },
    { id: "cursor-cli", label: "Cursor CLI", desc: "Cursor's background agent. Best for quick inline edits.", cmd: "cursor-agent" },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Start a new agent" width={540}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon="play"
            onClick={() => onStart({ agent, title: title || "Untitled task", branch: branch || project?.branch || "main" })}>
            Start agent
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px",
          background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 7,
          fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--text-dim)",
        }}>
          <Icon name="folder" size={12} style={{ color: "var(--text-faint)" }} />
          <span>cd</span>
          <span style={{ color: "var(--text)" }}>{project?.path}</span>
        </div>

        <div>
          <label style={{
            fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500,
            color: "var(--text-dim)", letterSpacing: "0.05em", textTransform: "uppercase",
            display: "block", marginBottom: 8,
          }}>Agent</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {agents.map(a => {
              const meta = AGENT_META[a.id];
              const selected = agent === a.id;
              return (
                <button key={a.id} onClick={() => setAgent(a.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                    padding: "12px 14px",
                    background: selected ? "var(--surface-2)" : "var(--surface-0)",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 8, cursor: "pointer",
                    color: "var(--text)",
                    boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: `${meta.color}22`,
                    border: `1px solid ${meta.color}44`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: meta.color, fontSize: 15, fontFamily: "var(--mono)",
                  }}>{meta.glyph}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{a.label}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                      {a.desc}
                    </div>
                  </div>
                  <code style={{
                    fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)",
                    background: "var(--surface-0)", padding: "3px 7px",
                    border: "1px solid var(--border)", borderRadius: 4,
                  }}>${a.cmd}</code>
                </button>
              );
            })}
          </div>
        </div>

        <TextField label="Task title" value={title} onChange={setTitle}
          placeholder="Add streaming support to SSE transport" />
        <TextField label="Git branch" mono value={branch} onChange={setBranch}
          placeholder={project?.branch || "main"} />
      </div>
    </Modal>
  );
};

// ── Root App ────────────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // apply theme
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
    document.documentElement.style.setProperty("--accent", t.accent);
    document.documentElement.style.setProperty("--accent-dim", t.accent + "26");
    document.documentElement.style.setProperty("--accent-faint", t.accent + "14");
    document.documentElement.style.setProperty("--status-running", t.accent);
  }, [t]);

  const [state, setState] = React.useState({
    view: "mission",           // mission | project | archive
    projectId: null,
    projects: SEED_PROJECTS,
    groups: SEED_GROUPS,
    openTerminals: [],         // [{projectId, taskId}]
    modal: null,               // 'add-project' | 'edit-project' | 'groups' | 'new-agent'
    modalProjectId: null,
  });

  const dispatch = (action) => {
    setState(s => {
      switch (action.type) {
        case "nav":
          return { ...s, view: action.view, projectId: action.projectId || null };
        case "toggle-pin":
          return { ...s, projects: s.projects.map(p => p.id === action.id ? { ...p, pinned: !p.pinned } : p) };
        case "toggle-terminal": {
          const exists = s.openTerminals.some(t => t.taskId === action.taskId);
          const next = exists
            ? s.openTerminals.filter(t => t.taskId !== action.taskId)
            : [...s.openTerminals, { projectId: action.projectId, taskId: action.taskId }].slice(-4);
          return { ...s, openTerminals: next };
        }
        case "close-all-terminals":
          return { ...s, openTerminals: [] };
        case "archive-task":
          return {
            ...s,
            projects: s.projects.map(p => p.id === action.projectId
              ? { ...p, tasks: p.tasks.map(t => t.id === action.taskId ? { ...t, archived: true } : t) }
              : p),
            openTerminals: s.openTerminals.filter(t => t.taskId !== action.taskId),
          };
        case "restore-task":
          return {
            ...s,
            projects: s.projects.map(p => p.id === action.projectId
              ? { ...p, tasks: p.tasks.map(t => t.id === action.taskId ? { ...t, archived: false } : t) }
              : p),
          };
        case "open-add-project": return { ...s, modal: "add-project", modalProjectId: null };
        case "open-edit-project": return { ...s, modal: "edit-project", modalProjectId: action.projectId };
        case "open-groups": return { ...s, modal: "groups" };
        case "open-new-agent": return { ...s, modal: "new-agent", modalProjectId: action.projectId };
        case "close-modal": return { ...s, modal: null, modalProjectId: null };
        case "save-project": {
          if (s.modalProjectId) {
            return {
              ...s, modal: null,
              projects: s.projects.map(p => p.id === s.modalProjectId ? { ...p, ...action.data } : p),
            };
          } else {
            const newP = {
              id: `p-${Date.now()}`,
              ...action.data,
              pinned: false, branch: "main", tasks: [],
            };
            return { ...s, modal: null, projects: [...s.projects, newP] };
          }
        }
        case "add-group":
          return {
            ...s,
            groups: [...s.groups, {
              id: `g-${Date.now()}`, name: action.name,
              color: ["#7ce58a","#8ab4ff","#c792ea","#fbbf24","#f472b6"][s.groups.length % 5],
            }],
          };
        case "remove-group":
          return {
            ...s,
            groups: s.groups.filter(g => g.id !== action.id),
            projects: s.projects.map(p => p.groupId === action.id ? { ...p, groupId: null } : p),
          };
        case "start-agent": {
          const t = {
            id: `t-${Date.now()}`,
            title: action.data.title,
            agent: action.data.agent,
            status: "running",
            branch: action.data.branch,
            updated: "just now",
            lines: 0,
            preview: `Starting ${AGENT_META[action.data.agent].label}…`,
          };
          return {
            ...s, modal: null,
            projects: s.projects.map(p => p.id === s.modalProjectId ? { ...p, tasks: [t, ...p.tasks] } : p),
            openTerminals: [...s.openTerminals, { projectId: s.modalProjectId, taskId: t.id }].slice(-4),
          };
        }
        default: return s;
      }
    });
  };

  const currentProject = state.projects.find(p => p.id === state.projectId);
  const modalProject = state.projects.find(p => p.id === state.modalProjectId);

  const crumbs = state.view === "project" && currentProject
    ? [{ label: currentProject.name }]
    : state.view === "archive"
    ? [{ label: "Archive" }]
    : [];

  return (
    <>
      <TopBar
        crumbs={crumbs}
        onHome={() => dispatch({ type: "nav", view: "mission" })}
        right={
          <>
            {state.view !== "mission" && (
              <Btn variant="ghost" icon="home" onClick={() => dispatch({ type: "nav", view: "mission" })}>
                Mission Control
              </Btn>
            )}
            <span style={{
              fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)",
              padding: "2px 7px", border: "1px solid var(--border)", borderRadius: 4,
            }}>⌘K</span>
          </>
        }
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {state.view === "mission" && <MissionControl state={state} dispatch={dispatch} />}
          {state.view === "project" && currentProject && (
            <ProjectView state={state} dispatch={dispatch} project={currentProject} />
          )}
          {state.view === "archive" && <ArchiveView state={state} dispatch={dispatch} />}
        </div>
        <TerminalPanel state={state} dispatch={dispatch} projects={state.projects} />
      </div>

      {/* Modals */}
      <ProjectDialog
        open={state.modal === "add-project" || state.modal === "edit-project"}
        project={state.modal === "edit-project" ? modalProject : null}
        groups={state.groups}
        onClose={() => dispatch({ type: "close-modal" })}
        onSave={(data) => dispatch({ type: "save-project", data })}
      />
      <GroupsDialog
        open={state.modal === "groups"}
        groups={state.groups}
        projects={state.projects}
        onClose={() => dispatch({ type: "close-modal" })}
        onAdd={(name) => dispatch({ type: "add-group", name })}
        onRemove={(id) => dispatch({ type: "remove-group", id })}
      />
      <NewAgentDialog
        open={state.modal === "new-agent"}
        project={modalProject}
        onClose={() => dispatch({ type: "close-modal" })}
        onStart={(data) => dispatch({ type: "start-agent", data })}
      />

      {/* Tweaks */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={t.theme} options={["dark", "light"]}
          onChange={(v) => setTweak("theme", v)} />
        <TweakColor label="Accent" value={t.accent} onChange={(v) => setTweak("accent", v)} />
        <TweakRadio label="Density" value={t.density} options={["compact", "regular", "spacious"]}
          onChange={(v) => setTweak("density", v)} />
        <TweakRadio label="Activity" value={t.activity} options={["shimmer", "pulse", "none"]}
          onChange={(v) => setTweak("activity", v)} />
        <TweakSection label="Demo" />
        <TweakButton label="Open 3 terminals"
          onClick={() => {
            // Open a mixed selection of 3 running/needs-input tasks
            const picks = [];
            for (const p of state.projects) {
              for (const tt of p.tasks) {
                if (!tt.archived && (tt.status === "running" || tt.status === "needs-input") && picks.length < 3) {
                  picks.push({ projectId: p.id, taskId: tt.id });
                }
              }
              if (picks.length >= 3) break;
            }
            setState(s => ({ ...s, openTerminals: picks }));
          }}
        />
        <TweakButton label="Close all terminals" secondary
          onClick={() => setState(s => ({ ...s, openTerminals: [] }))} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
