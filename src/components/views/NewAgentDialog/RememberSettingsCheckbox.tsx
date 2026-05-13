import { AGENT_META } from "~/lib/design-meta";
import type { TaskAgent } from "~/shared/domain";

export function RememberSettingsCheckbox({
  agent,
  checked,
  onChange,
}: {
  agent: TaskAgent;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: "var(--accent)" }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>
          Remember settings for this project
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            lineHeight: 1.4,
          }}
        >
          The New session button will skip this dialog and start{" "}
          <code style={{ color: "var(--text)" }}>{AGENT_META[agent].label}</code> directly.
        </div>
      </div>
    </label>
  );
}
