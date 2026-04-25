// components.jsx — shared UI primitives

// ── Icons (inline SVG, stroke-based) ────────────────────────────────────────
const Icon = ({ name, size = 14, style }) => {
  const s = size;
  const common = { width: s, height: s, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", style };
  switch (name) {
    case "plus": return <svg {...common}><path d="M8 3v10M3 8h10"/></svg>;
    case "pin": return <svg {...common}><path d="M10 2l4 4-2 1-1 4-3-3-4 4 4-4-3-3 4-1 1-2z"/></svg>;
    case "pin-fill": return <svg {...common} fill="currentColor" stroke="none"><path d="M10.5 1.8l3.7 3.7-1.9 1-1.1 3.9-2.8-2.8-4.2 4.2 4.2-4.2-2.8-2.8 3.9-1.1 1-1.9z"/></svg>;
    case "search": return <svg {...common}><circle cx="7" cy="7" r="4.5"/><path d="M13.5 13.5l-3-3"/></svg>;
    case "grid": return <svg {...common}><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></svg>;
    case "list": return <svg {...common}><path d="M2 4h12M2 8h12M2 12h12"/></svg>;
    case "folder": return <svg {...common}><path d="M2 4.5c0-.5.4-1 1-1h3l1.5 1.5H13c.5 0 1 .5 1 1V12c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1V4.5z"/></svg>;
    case "terminal": return <svg {...common}><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M4 6l2 2-2 2M8 10h4"/></svg>;
    case "chevron-right": return <svg {...common}><path d="M6 3l5 5-5 5"/></svg>;
    case "chevron-down": return <svg {...common}><path d="M3 6l5 5 5-5"/></svg>;
    case "chevron-left": return <svg {...common}><path d="M10 3L5 8l5 5"/></svg>;
    case "x": return <svg {...common}><path d="M3 3l10 10M13 3L3 13"/></svg>;
    case "more": return <svg {...common}><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/></svg>;
    case "check": return <svg {...common}><path d="M3 8l3 3 7-7"/></svg>;
    case "archive": return <svg {...common}><rect x="1.5" y="3" width="13" height="3"/><path d="M3 6v7h10V6M6 9h4"/></svg>;
    case "settings": return <svg {...common}><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M15 8h-2M3 8H1M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4M12.9 12.9l-1.4-1.4M4.5 4.5L3.1 3.1"/></svg>;
    case "git-branch": return <svg {...common}><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 4.5v7M4 9c0-2.5 2-3 4-3"/></svg>;
    case "home": return <svg {...common}><path d="M2 7l6-5 6 5v6.5c0 .3-.2.5-.5.5H10V9H6v5H2.5c-.3 0-.5-.2-.5-.5V7z"/></svg>;
    case "play": return <svg {...common}><path d="M4 3l9 5-9 5V3z" fill="currentColor"/></svg>;
    case "upload": return <svg {...common}><path d="M8 11V3M4 7l4-4 4 4M2 13h12"/></svg>;
    case "group": return <svg {...common}><rect x="1.5" y="3" width="5" height="5"/><rect x="9.5" y="3" width="5" height="5"/><rect x="5.5" y="9" width="5" height="5"/></svg>;
    case "refresh": return <svg {...common}><path d="M14 3v4h-4M2 13V9h4M13 7a5 5 0 00-9-2M3 9a5 5 0 009 2"/></svg>;
    case "sparkles": return <svg {...common}><path d="M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2L8 2zM12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L10.5 13l1.4-.6.6-1.4z"/></svg>;
    default: return null;
  }
};

// ── Status dot with pulse ───────────────────────────────────────────────────
const StatusDot = ({ status, size = 6 }) => {
  const meta = STATUS_META[status];
  if (!meta.dot) return null;
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: meta.color,
        boxShadow: status === "running" ? `0 0 8px ${meta.color}` : "none",
        animation: status === "running" ? "pulse-dot 1.6s ease-in-out infinite" : "none",
        flexShrink: 0,
      }}
    />
  );
};

// ── Status pill ─────────────────────────────────────────────────────────────
const StatusPill = ({ status, count }) => {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 8px 2px 7px",
      borderRadius: 999,
      background: "var(--surface-2)",
      border: "1px solid var(--border)",
      fontFamily: "var(--mono)",
      fontSize: 11,
      color: "var(--text-dim)",
      lineHeight: 1.4,
    }}>
      <StatusDot status={status} />
      {count != null && <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{count}</span>}
      <span>{meta.label.toLowerCase()}</span>
    </span>
  );
};

// ── Project icon tile ───────────────────────────────────────────────────────
const ProjectIcon = ({ project, size = 36 }) => {
  return (
    <div style={{
      width: size, height: size,
      borderRadius: size * 0.22,
      background: `linear-gradient(135deg, ${project.iconColor}22, ${project.iconColor}08)`,
      border: `1px solid ${project.iconColor}33`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--mono)",
      fontSize: size * 0.36,
      fontWeight: 600,
      color: project.iconColor,
      letterSpacing: "-0.02em",
      flexShrink: 0,
    }}>
      {project.icon}
    </div>
  );
};

// ── Agent glyph ─────────────────────────────────────────────────────────────
const AgentGlyph = ({ agent, showLabel = false, size = 11 }) => {
  const meta = AGENT_META[agent];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontFamily: "var(--mono)", fontSize: size, color: "var(--text-dim)",
    }}>
      <span style={{ color: meta.color, fontSize: size + 1 }}>{meta.glyph}</span>
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
};

// ── Button ──────────────────────────────────────────────────────────────────
const Btn = ({ variant = "ghost", icon, children, onClick, size = "md", style, ...rest }) => {
  const styles = {
    ghost: { background: "transparent", border: "1px solid var(--border)", color: "var(--text-dim)" },
    solid: { background: "var(--surface-2)", border: "1px solid var(--border-strong)", color: "var(--text)" },
    accent: { background: "var(--accent-dim)", border: "1px solid var(--accent)", color: "var(--accent)" },
    primary: { background: "var(--accent)", border: "1px solid var(--accent)", color: "#0a0b0d" },
    danger: { background: "transparent", border: "1px solid var(--border)", color: "var(--status-failed)" },
  };
  const sizes = {
    sm: { height: 24, padding: "0 8px", fontSize: 11, gap: 5 },
    md: { height: 30, padding: "0 12px", fontSize: 12.5, gap: 6 },
    lg: { height: 36, padding: "0 16px", fontSize: 13, gap: 7 },
  };
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: 7,
        fontFamily: "var(--sans)",
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
        whiteSpace: "nowrap",
        ...styles[variant],
        ...sizes[size],
        ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = variant === "primary" ? "oklch(0.87 0.17 145)" : variant === "ghost" ? "var(--surface-1)" : variant === "accent" ? "oklch(0.82 0.17 145 / 0.22)" : "var(--surface-3)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = styles[variant].background; }}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 11 : 13} />}
      {children}
    </button>
  );
};

// ── Top chrome (nav bar) ────────────────────────────────────────────────────
const TopBar = ({ crumbs, right, onHome }) => {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      height: 48, padding: "0 20px",
      background: "var(--surface-0)",
      borderBottom: "1px solid var(--border)",
      flexShrink: 0,
      position: "relative",
      zIndex: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          onClick={onHome}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            cursor: "pointer",
          }}
        >
          <div style={{
            width: 22, height: 22, borderRadius: 5,
            background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#0a0b0d",
            fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700,
          }}>M</div>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12.5, fontWeight: 600, letterSpacing: "0.02em" }}>
            MissionControl
          </span>
        </div>
        {crumbs && crumbs.length > 0 && (
          <>
            <Icon name="chevron-right" size={11} style={{ color: "var(--text-faint)" }} />
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 && <Icon name="chevron-right" size={11} style={{ color: "var(--text-faint)" }} />}
                <span
                  onClick={c.onClick}
                  style={{
                    fontFamily: "var(--mono)", fontSize: 12,
                    color: i === crumbs.length - 1 ? "var(--text)" : "var(--text-dim)",
                    cursor: c.onClick ? "pointer" : "default",
                  }}
                >
                  {c.label}
                </span>
              </React.Fragment>
            ))}
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {right}
      </div>
    </div>
  );
};

// ── Modal shell ─────────────────────────────────────────────────────────────
const Modal = ({ open, onClose, title, children, width = 480, footer }) => {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fade-up 0.12s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: "92vw", maxHeight: "85vh",
          background: "var(--surface-1)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, letterSpacing: "0.02em" }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex" }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>
          {children}
        </div>
        {footer && (
          <div style={{
            display: "flex", justifyContent: "flex-end", gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-0)",
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Text input ──────────────────────────────────────────────────────────────
const TextField = ({ label, hint, value, onChange, placeholder, mono, rightAddon }) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
        <label style={{
          fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500,
          color: "var(--text-dim)", letterSpacing: "0.05em", textTransform: "uppercase",
        }}>{label}</label>
      )}
      <div style={{
        display: "flex", alignItems: "center",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
      }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1,
            background: "transparent",
            border: 0, outline: 0,
            color: "var(--text)",
            padding: "9px 12px",
            fontFamily: mono ? "var(--mono)" : "var(--sans)",
            fontSize: 13,
          }}
        />
        {rightAddon && (
          <div style={{ padding: "0 10px", color: "var(--text-faint)", fontFamily: "var(--mono)", fontSize: 11 }}>
            {rightAddon}
          </div>
        )}
      </div>
      {hint && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }}>
          {hint}
        </div>
      )}
    </div>
  );
};

// ── Shimmer bar (running indicator) ─────────────────────────────────────────
const ShimmerBar = ({ active, color }) => {
  if (!active) {
    return <div style={{ height: 2, background: "var(--border)" }} />;
  }
  const c = color || "var(--accent)";
  return (
    <div style={{
      height: 2,
      background: `linear-gradient(90deg, transparent 0%, transparent 25%, ${c} 50%, transparent 75%, transparent 100%)`,
      backgroundSize: "200% 100%",
      animation: "shimmer 2.4s linear infinite",
    }} />
  );
};

Object.assign(window, {
  Icon, StatusDot, StatusPill, ProjectIcon, AgentGlyph, Btn, TopBar, Modal, TextField, ShimmerBar,
});
