import { differenceInSeconds, formatDistance } from "date-fns";

/**
 * Relative time like "3 minutes ago". Pass `baseDate` when labels must stay
 * stable across re-renders (e.g. search result timestamps).
 */
export function formatRelativeTime(
  timestampMs: number,
  baseDate: number | Date = Date.now(),
): string {
  const date = new Date(timestampMs);
  const base = typeof baseDate === "number" ? new Date(baseDate) : baseDate;

  if (differenceInSeconds(base, date) < 60) return "just now";

  const text = formatDistance(date, base, { addSuffix: true });
  if (text === "less than a minute ago") return "just now";

  return text;
}
