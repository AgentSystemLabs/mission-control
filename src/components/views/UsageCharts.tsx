import type { DailyUsage } from "~/shared/token-usage";

const COLORS = {
  input: "var(--accent)",
  output: "#5cb8ff",
  cacheCreate: "#8a8aff",
  cacheRead: "var(--text-faint)",
} as const;

function totalOf(d: DailyUsage): number {
  return (
    d.inputTokens + d.outputTokens + d.cacheCreationTokens + d.cacheReadTokens
  );
}

/** Stacked bar chart: per-day token usage. Pure inline SVG, no deps. */
export function TimeSeriesBars({
  data,
  height = 160,
}: {
  data: DailyUsage[];
  height?: number;
}) {
  const max = Math.max(1, ...data.map(totalOf));
  const barGap = 2;
  const W = 100; // logical units, scales via viewBox
  const barW = (W - barGap * (data.length - 1)) / data.length;

  return (
    <div style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block" }}
        role="img"
        aria-label="Token usage per day"
      >
        {data.map((d, i) => {
          const x = i * (barW + barGap);
          const scale = (height - 4) / max;
          const segments = [
            { v: d.outputTokens, color: COLORS.output },
            { v: d.inputTokens, color: COLORS.input },
            { v: d.cacheCreationTokens, color: COLORS.cacheCreate },
            { v: d.cacheReadTokens, color: COLORS.cacheRead },
          ];
          let yCursor = height;
          return (
            <g key={d.day}>
              <title>{`${d.day} — ${formatN(totalOf(d))} tokens`}</title>
              {segments.map((s, idx) => {
                if (s.v <= 0) return null;
                const h = s.v * scale;
                yCursor -= h;
                return (
                  <rect
                    key={idx}
                    x={x}
                    y={yCursor}
                    width={barW}
                    height={h}
                    fill={s.color}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--text-faint)",
          marginTop: 4,
        }}
      >
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  const items: Array<{ label: string; color: string }> = [
    { label: "input", color: COLORS.input as string },
    { label: "output", color: COLORS.output as string },
    { label: "cache write", color: COLORS.cacheCreate as string },
    { label: "cache read", color: COLORS.cacheRead as string },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        marginTop: 8,
        fontFamily: "var(--mono)",
        fontSize: 10,
        color: "var(--text-dim)",
      }}
    >
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: it.color,
              display: "inline-block",
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Single horizontal bar showing one project's share of the global total. */
export function HorizontalBar({
  value,
  max,
  color = "var(--accent)",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      style={{
        position: "relative",
        height: 6,
        background: "var(--surface-2, rgba(255,255,255,0.04))",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: color,
          transition: "width 240ms ease",
        }}
      />
    </div>
  );
}

export function formatN(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}
