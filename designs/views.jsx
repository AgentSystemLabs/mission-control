// views.jsx — main views

// ── Project Card ────────────────────────────────────────────────────────────
const ProjectCard = ({ project, density, onOpen, onTogglePin, onEdit }) => {
  const running = project.tasks.filter(t => t.status === "running").length;
  const needs = project.tasks.filter(t => t.status === "needs-input").length;
  const done = project.tasks.filter(t => t.status === "done").length;
  const hasActivity = running > 0;

  const isCompact = density === "compact";
  const isSpacious = density === "spacious";

  return (
    <div
      onClick={onOpen}
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, transform 0.15s, background 0.15s",
        display: "flex", flexDirection: "column",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-strong)";
        e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.background = "var(--surface-1)";
      }}
    >
      <ShimmerBar active={hasActivity} />
      <div style={{ padding: isCompact ? 12 : isSpacious ? 20 : 16, display: "flex", flexDirection: "column", gap: isCompact ? 10 : 14 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <ProjectIcon project={project} size={isCompact ? 30 : isSpacious ? 44 : 36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{
                fontFamily: "var(--mono)", fontSize: isCompact ? 13 : 14, fontWeight: 600,
                color: "var(--text)", letterSpacing: "-0.01em",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{project.name}</span>
              {project.pinned && (
                <Icon name="pin-fill" size={10} style={{ color: "var(--accent)", flexShrink: 0 }} />
              )}
            </div>
            <div style={{
              fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {project.path}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(project.id); }}
            style={{
              background: "transparent", border: 0, padding: 4, cursor: "pointer",
              color: project.pinned ? "var(--accent)" : "var(--text-faint)",
              display: "flex",
            }}
            title={project.pinned ? "Unpin" : "Pin"}
          >
            <Icon name={project.pinned ? "pin-fill" : "pin"} size={12} />
          </button>
        </div>

        {/* Branch */}
        {!isCompact && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)" }}>
            <Icon name="git-branch" size={11} style={{ color: "var(--text-faint)" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.branch}</span>
          </div>
        )}

        {/* Status summary */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {running > 0 && <StatusPill status="running" count={running} />}
          {needs > 0 && <StatusPill status="needs-input" count={needs} />}
          {done > 0 && <StatusPill status="done" count={done} />}
          {running + needs + done === 0 && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
              no active tasks
            </span>
          )}
        </div>

        {/* Activity preview */}
        {!isCompact && hasActivity && (
          <div style={{
            fontFamily: "var(--mono)", fontSize: 11,
            color: "var(--text-dim)",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <StatusDot status="running" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {project.tasks.find(t => t.status === "running")?.preview || "…"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Mission Control View ────────────────────────────────────────────────────
const MissionControl = ({ state, dispatch }) => {
  const [search, setSearch] = React.useState("");
  const [density, setDensity] = React.useState("regular");

  const filter = (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.path.toLowerCase().includes(search.toLowerCase());
  const pinned = state.projects.filter(p => p.pinned && filter(p));
  const byGroup = state.groups.map(g => ({
    group: g,
    projects: state.projects.filter(p => p.groupId === g.id && !p.pinned && filter(p)),
  })).filter(gr => gr.projects.length > 0);
  const ungrouped = state.projects.filter(p => !p.groupId && !p.pinned && filter(p));

  const gridCols = density === "compact" ? "repeat(auto-fill, minmax(240px, 1fr))"
                 : density === "spacious" ? "repeat(auto-fill, minmax(360px, 1fr))"
                 : "repeat(auto-fill, minmax(300px, 1fr))";

  const totalRunning = state.projects.reduce((a, p) => a + p.tasks.filter(t => t.status === "running").length, 0);
  const totalNeeds = state.projects.reduce((a, p) => a + p.tasks.filter(t => t.status === "needs-input").length, 0);
  const totalDone = state.projects.reduce((a, p) => a + p.tasks.filter(t => t.status === "done").length, 0);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 80px" }} className="dot-grid-bg">
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Heading */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24, gap: 24 }}>
          <div>
            <div style={{
              fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)",
              letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6,
            }}>
              ✦ {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Mission Control
            </h1>
            <div style={{ display: "flex", gap: 16, marginTop: 10, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
              <span><StatusDot status="running" /> <span style={{ color: "var(--text)", marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>{totalRunning}</span> running</span>
              <span><StatusDot status="needs-input" /> <span style={{ color: "var(--text)", marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>{totalNeeds}</span> awaiting input</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--status-done)" }} />
                <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{totalDone}</span> ready
              </span>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{
              display: "flex", alignItems: "center",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "0 10px",
              height: 32,
              width: 220,
            }}>
              <Icon name="search" size={12} style={{ color: "var(--text-faint)", marginRight: 6 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                style={{
                  flex: 1, background: "transparent", border: 0, outline: 0,
                  color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5,
                }}
              />
            </div>

            {/* Density toggle */}
            <div style={{
              display: "flex", padding: 2, background: "var(--surface-1)",
              border: "1px solid var(--border)", borderRadius: 7, height: 32,
            }}>
              {["compact", "regular", "spacious"].map(d => (
                <button key={d} onClick={() => setDensity(d)}
                  style={{
                    background: density === d ? "var(--surface-3)" : "transparent",
                    border: 0, color: density === d ? "var(--text)" : "var(--text-dim)",
                    borderRadius: 5, cursor: "pointer",
                    padding: "0 10px", fontFamily: "var(--mono)", fontSize: 11,
                  }}
                  title={d}
                >
                  {d === "compact" ? "▪" : d === "regular" ? "▪▪" : "▪▪▪"}
                </button>
              ))}
            </div>

            <Btn variant="ghost" icon="group" onClick={() => dispatch({ type: "open-groups" })}>Groups</Btn>
            <Btn variant="ghost" icon="archive" onClick={() => dispatch({ type: "nav", view: "archive" })}>Archive</Btn>
            <Btn variant="primary" icon="plus" onClick={() => dispatch({ type: "open-add-project" })}>Add project</Btn>
          </div>
        </div>

        {/* Pinned row */}
        {pinned.length > 0 && (
          <Section label="Pinned" count={pinned.length} icon="pin-fill">
            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
              {pinned.map(p => (
                <ProjectCard key={p.id} project={p} density={density}
                  onOpen={() => dispatch({ type: "nav", view: "project", projectId: p.id })}
                  onTogglePin={(id) => dispatch({ type: "toggle-pin", id })}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Groups */}
        {byGroup.map(({ group, projects }) => (
          <Section key={group.id} label={group.name} count={projects.length} dot={group.color}>
            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
              {projects.map(p => (
                <ProjectCard key={p.id} project={p} density={density}
                  onOpen={() => dispatch({ type: "nav", view: "project", projectId: p.id })}
                  onTogglePin={(id) => dispatch({ type: "toggle-pin", id })}
                />
              ))}
            </div>
          </Section>
        ))}

        {ungrouped.length > 0 && (
          <Section label="Ungrouped" count={ungrouped.length}>
            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 14 }}>
              {ungrouped.map(p => (
                <ProjectCard key={p.id} project={p} density={density}
                  onOpen={() => dispatch({ type: "nav", view: "project", projectId: p.id })}
                  onTogglePin={(id) => dispatch({ type: "toggle-pin", id })}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Empty */}
        {state.projects.filter(filter).length === 0 && (
          <EmptyState
            title={search ? "No matches" : "No projects yet"}
            subtitle={search ? "Try a different search." : "Add your first project to start running agents."}
            action={!search && <Btn variant="primary" icon="plus" onClick={() => dispatch({ type: "open-add-project" })}>Add project</Btn>}
          />
        )}
      </div>
    </div>
  );
};

// ── Section header ──────────────────────────────────────────────────────────
const Section = ({ label, count, icon, dot, children }) => {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        marginBottom: 14,
        paddingBottom: 8,
        borderBottom: "1px solid var(--border)",
      }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, boxShadow: `0 0 6px ${dot}66` }} />}
        {icon && <Icon name={icon} size={12} style={{ color: "var(--accent)" }} />}
        <span style={{
          fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.08em", textTransform: "uppercase",
          color: "var(--text)",
        }}>{label}</span>
        <span style={{
          fontFamily: "var(--mono)", fontSize: 11,
          color: "var(--text-faint)", fontVariantNumeric: "tabular-nums",
        }}>{count}</span>
      </div>
      {children}
    </div>
  );
};

// ── Empty state ─────────────────────────────────────────────────────────────
const EmptyState = ({ title, subtitle, action, icon = "sparkles" }) => (
  <div style={{
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "60px 20px", gap: 14,
    border: "1px dashed var(--border-strong)", borderRadius: 12,
    background: "var(--surface-0)",
  }}>
    <div style={{
      width: 44, height: 44, borderRadius: 10,
      background: "var(--surface-2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--text-dim)",
    }}>
      <Icon name={icon} size={20} />
    </div>
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", fontFamily: "var(--mono)" }}>{subtitle}</div>
    </div>
    {action}
  </div>
);

// ── Task Card ───────────────────────────────────────────────────────────────
const TaskCard = ({ task, selected, onToggle, onArchive }) => {
  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";

  return (
    <div
      onClick={() => onToggle(task.id)}
      style={{
        background: selected ? "var(--surface-2)" : "var(--surface-1)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "all 0.15s",
        position: "relative",
        boxShadow: selected ? "0 0 0 1px var(--accent), 0 0 16px var(--accent-faint)" : "none",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = "var(--border-strong)"; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = "var(--border)"; }}
    >
      <ShimmerBar active={isRunning} color={meta.color} />
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <StatusDot status={task.status} size={7} />
              <span style={{
                fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500,
                color: statusMeta.color, letterSpacing: "0.05em", textTransform: "uppercase",
              }}>
                {statusMeta.label}
              </span>
              <span style={{ color: "var(--text-faint)", fontSize: 10, fontFamily: "var(--mono)" }}>·</span>
              <AgentGlyph agent={task.agent} showLabel={true} size={10.5} />
            </div>
            <div style={{
              fontSize: 13.5, fontWeight: 500, lineHeight: 1.35,
              color: "var(--text)",
              marginBottom: 4,
            }}>
              {task.title}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="git-branch" size={10} /> {task.branch}
              </span>
              <span>·</span>
              <span>+{task.lines} lines</span>
              <span>·</span>
              <span>{task.updated}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{
              width: 18, height: 18, borderRadius: 4,
              border: selected ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
              background: selected ? "var(--accent)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#0a0b0d",
            }}>
              {selected && <Icon name="check" size={11} />}
            </div>
          </div>
        </div>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 10px",
          lineHeight: 1.45,
        }}>
          {task.preview}
          {isRunning && <span style={{ marginLeft: 2, animation: "caret 1s infinite", color: meta.color }}>▊</span>}
        </div>
        {task.status === "done" && (
          <div style={{ display: "flex", gap: 6 }}>
            <Btn size="sm" variant="accent" icon="upload" onClick={(e) => { e.stopPropagation(); }}>
              Commit & push
            </Btn>
            <Btn size="sm" variant="ghost" icon="archive" onClick={(e) => { e.stopPropagation(); onArchive(task.id); }}>
              Archive
            </Btn>
          </div>
        )}
        {task.status === "needs-input" && (
          <Btn size="sm" variant="accent" icon="terminal" onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}>
            Open terminal to reply
          </Btn>
        )}
      </div>
    </div>
  );
};

Object.assign(window, { ProjectCard, MissionControl, Section, EmptyState, TaskCard });
