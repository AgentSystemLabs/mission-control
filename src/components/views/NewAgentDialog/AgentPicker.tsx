import { AGENT_META } from "~/lib/design-meta";
import type { TaskAgent } from "~/shared/domain";
import { AGENT_OPTIONS } from "./types";

export function AgentPicker({
  agent,
  onSelect,
}: {
  agent: TaskAgent;
  onSelect: (next: TaskAgent) => void;
}) {
  return (
    <div>
      <label
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--text-dim)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          display: "block",
          marginBottom: 8,
        }}
      >
        Agent
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {AGENT_OPTIONS.map((a) => {
          const meta = AGENT_META[a.id];
          const selected = agent === a.id;
          return (
            <button
              key={a.id}
              onClick={() => !a.disabled && onSelect(a.id)}
              disabled={a.disabled}
              aria-disabled={a.disabled}
              title={a.disabled ? "Coming soon" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                padding: "12px 14px",
                background: selected ? "var(--surface-2)" : "var(--surface-0)",
                border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 8,
                cursor: a.disabled ? "not-allowed" : "pointer",
                color: "var(--text)",
                boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
                opacity: a.disabled ? 0.5 : 1,
              }}
            >
              <div
                style={{
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
                  fontFamily: "var(--mono)",
                }}
              >
                {meta.glyph}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{a.label}</div>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--text-dim)",
                    lineHeight: 1.4,
                  }}
                >
                {a.description}
                </div>
              </div>
              <code
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--text-faint)",
                  background: "var(--surface-0)",
                  padding: "3px 7px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  textTransform: a.disabled ? "uppercase" : "none",
                  letterSpacing: a.disabled ? "0.05em" : "normal",
                }}
              >
                {a.disabled ? "Coming soon" : `$${a.command}`}
              </code>
            </button>
          );
        })}
      </div>
    </div>
  );
}
