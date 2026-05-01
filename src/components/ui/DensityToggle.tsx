import { DENSITY_VALUES, type Density } from "~/lib/density";

const GLYPH: Record<Density, string> = {
  compact: "▪",
  regular: "▪▪",
  spacious: "▪▪▪",
};

export function DensityToggle({
  value,
  onChange,
  ariaLabel = "Card density",
}: {
  value: Density;
  onChange: (next: Density) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        padding: 2,
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        height: 32,
      }}
    >
      {DENSITY_VALUES.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          title={d}
          aria-label={`${d} density`}
          aria-pressed={value === d}
          style={{
            background: value === d ? "var(--surface-3)" : "transparent",
            border: 0,
            color: value === d ? "var(--text)" : "var(--text-dim)",
            borderRadius: 5,
            cursor: "pointer",
            padding: "0 10px",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          {GLYPH[d]}
        </button>
      ))}
    </div>
  );
}
