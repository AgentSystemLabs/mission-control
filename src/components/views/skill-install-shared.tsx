// Shared building blocks for the diagram/ship skill-install modals, which are
// structurally parallel (pick CLI harnesses → install → notice/error).

/** A labeled checkbox card selecting one CLI harness to install the skill into. */
export function SkillHarnessCheckRow({
  label,
  sub,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 11px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--surface-0)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            fontFamily: "var(--mono)",
          }}
        >
          {sub}
        </span>
      </span>
    </label>
  );
}

/** Oxford-comma join: `[]`→"", `[a]`→"a", `[a,b]`→"a and b", `[a,b,c]`→"a, b, and c". */
export function formatHarnessList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
