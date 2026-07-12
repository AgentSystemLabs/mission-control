import { useEffect, useRef, useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import type { ClaudeUsageLimits, ClaudeUsageWindow } from "~/shared/claude-usage-limits";
import { useClaudeUsageLimits, useSettings } from "~/queries";

/**
 * Top-bar indicator for Claude Code's live usage limits. Renders a compact
 * double-radial gauge: the outer ring tracks the weekly window and the inner
 * ring the 5-hour session window — each arc grows and shifts color green →
 * amber → red as its limit is consumed. Clicking it opens a popover with the
 * full breakdown (session, weekly, and Opus windows with reset times). Renders
 * nothing unless the user opted in via Settings → Terminal. Data comes from the
 * server's cached fetch of Anthropic's OAuth usage endpoint
 * (src/server/services/claude-usage-limits.ts).
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

  // Two concentric rings: the outer tracks the weekly window, the inner tracks
  // the 5-hour session window. Each is null when its data is missing or the
  // user hid it in Settings, in which case that ring isn't drawn.
  const sessionPct = showSession ? toPct(data?.session) : null;
  const weeklyPct = showWeekly ? toPct(data?.weekly) : null;

  const parts: string[] = [];
  if (sessionPct !== null) parts.push(`${sessionPct}% of 5h session`);
  if (weeklyPct !== null) parts.push(`${weeklyPct}% of weekly`);
  const ariaLabel = parts.length ? `Claude usage: ${parts.join(", ")}` : "Claude usage limits";

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
        aria-label={ariaLabel}
        title={tip}
        style={{ width: 42, padding: 0 }}
      >
        <span className="mc-btn-content">
          <UsagePie sessionPct={sessionPct} weeklyPct={weeklyPct} />
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

/** Clamp a usage window to a 0–100 integer percentage, or null when absent. */
function toPct(window: ClaudeUsageWindow | null | undefined): number | null {
  return window ? Math.max(0, Math.min(100, Math.round(window.utilization))) : null;
}

/**
 * The top-bar gauge: two concentric donut rings. The outer ring tracks the
 * weekly window, the inner ring tracks the 5-hour session window, and each arc
 * sweeps clockwise from 12 o'clock as its usage grows. The centered number
 * mirrors the inner (session) ring — the more immediate limit — falling back to
 * the weekly value when the session window is hidden or unavailable. When only
 * one window is present it takes the outer radius so it reads as a single ring;
 * when neither is available a dim empty ring with a dash is shown.
 */
function UsagePie({
  sessionPct,
  weeklyPct,
}: {
  sessionPct: number | null;
  weeklyPct: number | null;
}) {
  const size = 24;
  const center = size / 2;
  const strokeWidth = 2.25;
  const gap = 1.25;
  const outerR = (size - strokeWidth) / 2;
  const innerR = outerR - strokeWidth - gap;

  const both = sessionPct !== null && weeklyPct !== null;
  // The center number tracks the session ring; fall back to weekly.
  const centerPct = sessionPct ?? weeklyPct;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Outer ring: weekly window (or the single window in view). */}
      {weeklyPct !== null && (
        <UsageRing pct={weeklyPct} r={outerR} center={center} strokeWidth={strokeWidth} />
      )}
      {/* Inner ring: 5-hour session. Promoted to the outer radius when it's the
          only window shown, so a lone ring doesn't look shrunken. */}
      {sessionPct !== null && (
        <UsageRing
          pct={sessionPct}
          r={both ? innerR : outerR}
          center={center}
          strokeWidth={strokeWidth}
        />
      )}
      {/* Nothing available yet — a dim empty ring to anchor the dash. */}
      {sessionPct === null && weeklyPct === null && (
        <UsageRing pct={null} r={outerR} center={center} strokeWidth={strokeWidth} />
      )}
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--mono)"
        // Three digits (100) need a touch less size to stay inside the rings.
        fontSize={centerPct !== null && centerPct >= 100 ? 6 : 7}
        fontWeight={700}
        fill={centerPct !== null ? "var(--text)" : "var(--text-faint)"}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {centerPct !== null ? centerPct : "–"}
      </text>
    </svg>
  );
}

/**
 * One ring of the usage gauge: a faint full-circle track plus a colored arc
 * that fills clockwise from 12 o'clock in proportion to `pct`. `pct === null`
 * draws only the dim track (empty state).
 */
function UsageRing({
  pct,
  r,
  center,
  strokeWidth,
}: {
  pct: number | null;
  r: number;
  center: number;
  strokeWidth: number;
}) {
  const circumference = 2 * Math.PI * r;
  const color = pct !== null ? usageColor(pct) : "var(--text-faint)";
  const fill = pct !== null ? (pct / 100) * circumference : 0;
  return (
    <>
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
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
    </>
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
