import { useEffect, useRef, useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import type { ClaudeUsageLimits, ClaudeUsageWindow } from "~/shared/claude-usage-limits";
import { useClaudeUsageLimits, useSettings } from "~/queries";

/**
 * Top-bar indicator for Claude Code's live usage limits. Renders a compact
 * pie-chart circle showing the current session (5h) utilization — the wedge
 * grows and the color shifts green → amber → red as the limit is consumed.
 * Clicking it opens a popover with the full breakdown (session, weekly, and
 * Opus windows with reset times). Renders nothing unless the user opted in via
 * Settings → Terminal. Data comes from the server's cached fetch of Anthropic's
 * OAuth usage endpoint (src/server/services/claude-usage-limits.ts).
 */
export function ClaudeUsageLimitsIndicator() {
  const { data: settings } = useSettings();
  const enabled = settings?.claudeUsageLimitsEnabled ?? false;
  const showSession = settings?.claudeUsageLimitsShowSession ?? true;
  const showWeekly = settings?.claudeUsageLimitsShowWeekly ?? true;
  const { data, isLoading } = useClaudeUsageLimits(enabled);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!enabled) return null;
  // The user turned both windows off — respect that and show nothing.
  if (!showSession && !showWeekly) return null;

  // The circle tracks the session window; fall back to weekly when the
  // session window is unavailable or hidden.
  const primary =
    (showSession ? data?.session : null) ?? (showWeekly ? data?.weekly : null) ?? null;
  const pct =
    primary !== null ? Math.max(0, Math.min(100, Math.round(primary.utilization))) : null;

  const tip = data && data.status === "ok" && (data.session || data.weekly)
    ? buildTooltip(data)
    : statusTip(isLoading, data);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        className="mc-btn mc-btn-ghost mc-btn-md"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          pct !== null ? `Claude usage: ${pct}% of session limit` : "Claude usage limits"
        }
        title={tip}
        style={{ width: 42, padding: 0 }}
      >
        <span className="mc-btn-content">
          <UsagePie pct={pct} />
        </span>
      </button>
      {open && (
        <CardFrame
          role="dialog"
          aria-label="Claude usage limits"
          solid
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 280,
            maxWidth: "calc(100vw - 32px)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            boxShadow: "0 16px 36px rgba(0,0,0,0.46)",
            zIndex: 200,
          }}
        >
          <div
            style={{
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "2px 2px 0",
            }}
          >
            Claude usage
          </div>
          <PopoverBody
            data={data}
            isLoading={isLoading}
            showSession={showSession}
            showWeekly={showWeekly}
          />
        </CardFrame>
      )}
    </div>
  );
}

function PopoverBody({
  data,
  isLoading,
  showSession,
  showWeekly,
}: {
  data: ClaudeUsageLimits | undefined;
  isLoading: boolean;
  showSession: boolean;
  showWeekly: boolean;
}) {
  const rows: React.ReactNode[] = [];
  if (data) {
    if (showSession && data.session) {
      rows.push(<UsageRow key="session" label="Session (5h)" window={data.session} />);
    }
    if (showWeekly && data.weekly) {
      rows.push(<UsageRow key="weekly" label="Week (all models)" window={data.weekly} />);
    }
    if (showWeekly && data.weeklyOpus) {
      rows.push(<UsageRow key="weeklyOpus" label="Week (Opus)" window={data.weeklyOpus} />);
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: "10px 2px", color: "var(--text-dim)", fontSize: 12 }}>
        {statusTip(isLoading, data)}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows}
      {data && data.status !== "ok" && (
        <div style={{ color: "var(--text-faint)", fontSize: 11 }}>
          Showing cached numbers — {statusTip(isLoading, data)}
        </div>
      )}
    </div>
  );
}

function UsageRow({ label, window }: { label: string; window: ClaudeUsageWindow }) {
  const pct = Math.max(0, Math.min(100, Math.round(window.utilization)));
  const reset = formatReset(window.resetsAt);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          fontFamily: "var(--mono)",
          fontSize: 11,
          lineHeight: 1,
        }}
      >
        <span style={{ color: "var(--text-dim)" }}>{label}</span>
        <span
          style={{
            color: usageColor(pct),
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {pct}%
        </span>
      </div>
      <span
        aria-hidden
        style={{
          position: "relative",
          height: 6,
          borderRadius: 3,
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            insetBlock: 0,
            insetInlineStart: 0,
            width: `${pct}%`,
            background: usageColor(pct),
            borderRadius: 3,
          }}
        />
      </span>
      {reset && (
        <div
          style={{
            color: "var(--text-faint)",
            fontFamily: "var(--mono)",
            fontSize: 10,
            lineHeight: 1,
          }}
        >
          ↻ resets {reset}
        </div>
      )}
    </div>
  );
}

/**
 * The top-bar gauge: a donut ring whose arc sweeps clockwise from 12 o'clock
 * as usage grows, with the percentage number centered inside. A ring (rather
 * than a filled pie) keeps the number readable at this size. `pct === null`
 * (no data yet) renders a dim empty ring with a dash.
 */
function UsagePie({ pct }: { pct: number | null }) {
  const size = 22;
  const strokeWidth = 2.5;
  const center = size / 2;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const color = pct !== null ? usageColor(pct) : "var(--text-faint)";
  const fill = pct !== null ? (pct / 100) * circumference : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle
        cx={center}
        cy={center}
        r={r}
        fill={`color-mix(in srgb, ${color} 8%, transparent)`}
        stroke={`color-mix(in srgb, ${color} 25%, var(--border))`}
        strokeWidth={strokeWidth}
      />
      {fill > 0 && (
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${fill} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--mono)"
        // Three digits (100) need a touch less size to stay inside the ring.
        fontSize={pct !== null && pct >= 100 ? 6.5 : 7.5}
        fontWeight={700}
        fill={pct !== null ? "var(--text)" : "var(--text-faint)"}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {pct !== null ? pct : "–"}
      </text>
    </svg>
  );
}

function statusTip(isLoading: boolean, data: ClaudeUsageLimits | undefined): string {
  if (isLoading || !data) return "Fetching Claude usage limits…";
  // Prefer the server's exact reason (HTTP status / response body) when present.
  const detail = data.error ? ` — ${data.error}` : "";
  switch (data.status) {
    case "unauthenticated":
      return `Couldn't read your Claude login. Sign in to Claude Code, then reopen the app.${detail}`;
    case "rate_limited":
      return `Anthropic rate-limited the usage request.${detail}`;
    case "error":
      return `Couldn't load usage.${detail}`;
    default:
      // status "ok" but no windows returned for the enabled toggles.
      return "No usage windows reported for the selected options.";
  }
}

/** Green under 70%, amber 70–90%, red at/above 90% — theme-aware status colors. */
function usageColor(pct: number): string {
  if (pct >= 90) return "var(--status-failed)";
  if (pct >= 70) return "var(--status-warning)";
  return "var(--status-done)";
}

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "Fri 06:49" — short weekday + 24h time in the user's local timezone. */
function formatReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${weekdayFmt.format(d)} ${timeFmt.format(d)}`;
}

function buildTooltip(data: ClaudeUsageLimits): string {
  const line = (name: string, w: ClaudeUsageWindow | null) => {
    if (!w) return null;
    const reset = formatReset(w.resetsAt);
    return `${name}: ${Math.round(w.utilization)}%${reset ? ` · resets ${reset}` : ""}`;
  };
  const lines = [
    line("Session (5h)", data.session),
    line("Week (all)", data.weekly),
    line("Week (Opus)", data.weeklyOpus),
  ].filter((l): l is string => l !== null);
  if (data.status !== "ok") {
    lines.push(`(${data.status}${data.error ? `: ${data.error}` : ""})`);
  }
  return lines.join("\n");
}
