import { AGENT_META } from "~/lib/design-meta";
import type { TaskAgent } from "~/db/schema";

export function AgentGlyph({
  agent,
  showLabel = false,
  size = 11,
}: {
  agent: TaskAgent;
  showLabel?: boolean;
  size?: number;
}) {
  const meta = AGENT_META[agent];
  if (!meta) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--mono)",
        fontSize: size,
        color: "var(--text-dim)",
      }}
    >
      <span style={{ color: meta.color, fontSize: size + 1 }}>{meta.glyph}</span>
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
}
