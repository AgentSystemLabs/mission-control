import type { ClaudeUsageLimits, ClaudeUsageWindow } from "~/shared/claude-usage-limits";
import { useClaudeUsageLimits, useSettings } from "~/queries";

/**
 * Top-bar indicator for Claude Code's live usage limits — session (5h) and
 * weekly windows with reset times. Renders nothing unless the user opted in via
 * Settings → Terminal. Data comes from the server's cached fetch of Anthropic's
 * OAuth usage endpoint (src/server/services/claude-usage-limits.ts).
 */
export function ClaudeUsageLimitsIndicator() {
  const { data: settings } = useSettings();
  const enabled = settings?.claudeUsageLimitsEnabled ?? false;
  const showSession = settings?.claudeUsageLimitsShowSession ?? true;
  const showWeekly = settings?.claudeUsageLimitsShowWeekly ?? true;
  const { data, isLoading } = useClaudeUsageLimits(enabled);

  if (!enabled) return null;
  // The user turned both windows off — respect that and show nothing.
  if (!showSession && !showWeekly) return null;

  const segments: React.ReactNode[] = [];
  if (data) {
    if (showSession && data.session) {
      segments.push(<UsageSegment key="session" label="session" window={data.session} />);
    }
    if (showWeekly && data.weekly) {
      segments.push(<UsageSegment key="weekly" label="week" window={data.weekly} />);
    }
  }

  const containerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 14,
    padding: "0 6px",
    fontFamily: "var(--mono)",
    fontSize: 11,
    lineHeight: 1,
    whiteSpace: "nowrap",
    ["WebkitAppRegion" as unknown as string]: "no-drag",
  };

  // We have real numbers — the normal case.
  if (segments.length > 0) {
    return (
      <div
        title={buildTooltip(data!)}
        aria-label="Claude Code usage limits"
        style={{ ...containerStyle, opacity: data!.status === "ok" ? 1 : 0.55 }}
      >
        {segments}
      </div>
    );
  }

  // No renderable numbers yet. Rather than vanish (which reads as "broken"),
  // show a compact, discoverable status chip so the feature is always visible
  // while enabled.
  const { label, tip } = statusChip(isLoading, data);
  return (
    <div
      title={tip}
      aria-label="Claude Code usage limits"
      style={{ ...containerStyle, color: "var(--text-dim)", opacity: 0.75 }}
    >
      usage · {label}
    </div>
  );
}

function statusChip(
  isLoading: boolean,
  data: ClaudeUsageLimits | undefined,
): { label: string; tip: string } {
  if (isLoading || !data) {
    return { label: "…", tip: "Fetching Claude usage limits…" };
  }
  // Prefer the server's exact reason (HTTP status / response body) when present.
  const detail = data.error ? ` — ${data.error}` : "";
  switch (data.status) {
    case "unauthenticated":
      return {
        label: "sign in",
        tip: `Couldn't read your Claude login. Sign in to Claude Code, then reopen the app.${detail}`,
      };
    case "rate_limited":
      return { label: "rate-limited", tip: `Anthropic rate-limited the usage request.${detail}` };
    case "error":
      return { label: "unavailable", tip: `Couldn't load usage.${detail}` };
    default:
      // status "ok" but no windows returned for the enabled toggles.
      return { label: "—", tip: "No usage windows reported for the selected options." };
  }
}

function UsageSegment({ label, window }: { label: string; window: ClaudeUsageWindow }) {
  const pct = Math.max(0, Math.min(100, Math.round(window.utilization)));
  const reset = formatReset(window.resetsAt);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span
        aria-hidden
        style={{
          position: "relative",
          width: 34,
          height: 6,
          borderRadius: 3,
          background: "var(--surface-2)",
          overflow: "hidden",
          flexShrink: 0,
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
      <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
      {reset && <span style={{ color: "var(--text-faint)" }}>↻&nbsp;{reset}</span>}
    </span>
  );
}

/** Green under 70%, amber 70–85%, red at/above 85% — theme-aware status colors. */
function usageColor(pct: number): string {
  if (pct >= 85) return "var(--status-failed)";
  if (pct >= 70) return "var(--status-warning)";
  return "var(--status-done)";
}

/** "Fri 06:49" — short weekday + 24h time in the user's local timezone. */
function formatReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${weekday} ${time}`;
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
