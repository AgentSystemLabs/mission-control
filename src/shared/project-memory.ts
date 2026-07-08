import { MS_PER_DAY } from "./time-ms";

// Shared types + constants for Recall — Mission Control's project-level memory.
// A "memory" is a small, curated, typed fact about a project that is fed to new
// agent sessions as a Session Brief so the agent doesn't rediscover the project
// from scratch. Kept framework-free so both the server (repo/service) and the
// renderer (api client / UI) can import it.

/** Typed categories. The order here doubles as the display order in the panel. */
export const MEMORY_TYPES = [
  "overview",
  "stack",
  "architecture",
  "decision",
  "convention",
  "glossary",
  "known-issue",
  "preference",
  "discovery",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** active = in the brief; archived = soft-deleted (recoverable, excluded from brief). */
export const MEMORY_STATUSES = ["active", "archived"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/** How confident we are a fact is correct: confirmed / inferred / ambiguous. */
export const MEMORY_CONFIDENCES = ["confirmed", "inferred", "ambiguous"] as const;
export type MemoryConfidence = (typeof MEMORY_CONFIDENCES)[number];

/** Where the memory came from — surfaced as provenance in the UI. */
export const MEMORY_SOURCES = ["manual", "voice", "agent", "auto-distill", "import"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/**
 * Outcome of a "verify against code" pass (Phase 3 hygiene). `verified` = the
 * claim still holds; `stale` = it can no longer be confirmed; `contradicted` =
 * the code proves it wrong (→ auto-supersede with a correction); `skipped` = the
 * pass didn't run (engine off, sandboxed project, or CLI failure).
 */
export const MEMORY_VERIFY_VERDICTS = ["verified", "stale", "contradicted", "skipped"] as const;
export type MemoryVerifyVerdict = (typeof MEMORY_VERIFY_VERDICTS)[number];

export const DEFAULT_MEMORY_TYPE: MemoryType = "discovery";
export const DEFAULT_MEMORY_STATUS: MemoryStatus = "active";
export const DEFAULT_MEMORY_CONFIDENCE: MemoryConfidence = "inferred";
export const DEFAULT_MEMORY_SOURCE: MemorySource = "manual";

// Size guards — a memory is a headline + short detail, never a transcript.
export const MEMORY_TITLE_MAX = 200;
export const MEMORY_BODY_MAX = 4_000;
export const MEMORY_TAGS_MAX = 12;
export const MEMORY_TAG_MAX = 40;
/** Cap on how many memories a single auto-distill pass may add to one project. */
export const MEMORY_AUTO_CAPTURE_PER_SESSION_MAX = 5;

const MS_PER_DAY = 86_400_000;

/**
 * A memory is considered "stale" once this long has passed since it was last
 * verified, used, or created (whichever is most recent). Stale unpinned memories
 * sink in the brief ranking and are flagged for review in the panel. Pinned
 * memories are exempt from decay.
 */
export const MEMORY_STALE_AFTER_MS = 60 * MS_PER_DAY;

/**
 * Relevance weight per type when assembling the Session Brief. Higher = more
 * likely to be included. `overview`/`stack` define the project so they always
 * lead; discoveries are useful but the most disposable.
 */
export const MEMORY_TYPE_WEIGHT: Record<MemoryType, number> = {
  overview: 100,
  stack: 90,
  architecture: 80,
  convention: 70,
  decision: 60,
  "known-issue": 55,
  glossary: 45,
  preference: 40,
  discovery: 30,
};

/** Human labels per type, for UI headings and the rendered brief. */
export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  overview: "Overview",
  stack: "Tech stack",
  architecture: "Architecture",
  decision: "Decisions",
  convention: "Conventions",
  glossary: "Glossary",
  "known-issue": "Known issues",
  preference: "Preferences",
  discovery: "Discoveries",
};

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}

export function isMemoryConfidence(value: unknown): value is MemoryConfidence {
  return typeof value === "string" && (MEMORY_CONFIDENCES as readonly string[]).includes(value);
}

/**
 * The most recent "freshness" signal for a memory: the latest of when it was
 * verified against code, last used in a brief, or created. Decay is measured
 * from this point so a memory that's still being used doesn't read as stale.
 */
export function memoryFreshnessRef(
  m: Pick<MemoryView, "lastVerifiedAt" | "lastUsedAt" | "createdAt">,
): number {
  return Math.max(m.lastVerifiedAt ?? 0, m.lastUsedAt ?? 0, m.createdAt);
}

/**
 * Whether a memory has gone stale (unverified/unused past the threshold).
 * Pinned memories never go stale. Shared by the server ranker and the panel so
 * "sinks in ranking" and the UI "stale" flag agree on one definition.
 */
export function isMemoryStale(
  m: Pick<MemoryView, "pinned" | "lastVerifiedAt" | "lastUsedAt" | "createdAt">,
  now: number,
): boolean {
  if (m.pinned) return false;
  return now - memoryFreshnessRef(m) > MEMORY_STALE_AFTER_MS;
}

/** Parse the JSON-encoded `tags` column into a clean, capped string[]. */
export function parseMemoryTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, MEMORY_TAG_MAX);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MEMORY_TAGS_MAX) break;
  }
  return out;
}

/** Serialize tags for storage, or `null` when empty (matches nullable column). */
export function serializeMemoryTags(tags: readonly string[] | null | undefined): string | null {
  if (!tags) return null;
  const cleaned = parseMemoryTags(JSON.stringify(tags));
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

/**
 * Client-facing shape of a memory: the DB row with `tags` already parsed to a
 * string[]. The server maps rows to this before responding, so renderer code
 * never re-parses JSON. Structural (not Drizzle-derived) so it's importable
 * anywhere without pulling in the DB layer.
 */
export interface MemoryView {
  id: string;
  projectId: string;
  scopeId: string;
  type: MemoryType;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  status: MemoryStatus;
  confidence: MemoryConfidence;
  source: MemorySource;
  sourceTaskId: string | null;
  supersededById: string | null;
  usageCount: number;
  lastVerifiedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Payload to create a memory. Only `type` + `title` are required. */
export interface MemoryCreateInput {
  projectId: string;
  scopeId?: string;
  type: MemoryType;
  title: string;
  body?: string;
  tags?: string[];
  pinned?: boolean;
  confidence?: MemoryConfidence;
  source?: MemorySource;
  sourceTaskId?: string | null;
}

/** Partial update. `title`/`body`/`type`/`tags`/`pinned`/`confidence` are user-editable. */
export interface MemoryUpdateInput {
  type?: MemoryType;
  title?: string;
  body?: string;
  tags?: string[];
  pinned?: boolean;
  confidence?: MemoryConfidence;
  status?: MemoryStatus;
}
