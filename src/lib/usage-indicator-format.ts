// Presentation helpers shared by the top-bar usage indicators (Claude-only and
// multi-provider). Both color utilization the same way and print reset times in
// the same "Fri 06:49" shape so the two controls read as one system.

/** Utilization at which a window is worth naming / turns amber. */
export const USAGE_WARN_PCT = 70;
/** Utilization at which a window turns red. */
export const USAGE_HOT_PCT = 90;

/** Green under 70%, amber 70–90%, red at/above 90% — theme-aware status colors. */
export function usageColor(pct: number): string {
  if (pct >= USAGE_HOT_PCT) return "var(--status-failed)";
  if (pct >= USAGE_WARN_PCT) return "var(--status-warning)";
  return "var(--status-done)";
}

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "06:49" — 24h clock time in the user's local timezone. */
export function formatClockTime(date: Date): string {
  return timeFmt.format(date);
}

/** "Fri 06:49" — short weekday + 24h time in the user's local timezone. */
export function formatReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${weekdayFmt.format(d)} ${timeFmt.format(d)}`;
}
