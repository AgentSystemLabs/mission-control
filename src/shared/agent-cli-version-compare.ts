import type { AgentCliVersionScheme } from "./agent-cli-config";
import { versionCore } from "./semver";

export function extractCliVersion(text: string): string | null {
  const match = text.match(/\bv?(\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match?.[1] ?? null;
}

export function comparableVersionParts(version: string): number[] {
  return versionCore(version).split(".").map((part) => Number(part));
}

export function compareCliVersions(
  a: string,
  b: string,
  scheme: AgentCliVersionScheme = "semver",
): number {
  const left = comparableVersionParts(a);
  const right = comparableVersionParts(b);
  const length = Math.max(left.length, right.length, 3);
  // Cursor reports calendar builds like `2026.05.20-2b5dd59`. The hash is not
  // orderable, so compare only the date triplet and document that in config.
  const compareLength = scheme === "calendar-date" ? 3 : length;
  for (let i = 0; i < compareLength; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
