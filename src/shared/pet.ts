// Mission Pet — persistent identity (name, XP, personality) shared by the
// settings controller (persistence + validation) and the renderer (pet store),
// so the shape lives here rather than in src/lib.
//
// The pet earns XP only from real work (finished sessions, ships, PRs) — there
// are no artificial care stats. Personality is rolled once per install from a
// seeded PRNG and shapes which speech-bubble lines the pet favors.

export type PetPersonality = {
  /** Dry, sarcastic lines. */
  snark: number;
  /** Practical, advice-flavored lines. */
  wisdom: number;
  /** Absurdist lines. */
  chaos: number;
  /** Calm, understated lines. */
  zen: number;
};

export const PET_SPECIES_IDS = [
  "mochi",
  "bunny",
  "chick",
  "cub",
  "lotl",
  "rivet",
  "trundle",
  "ember",
] as const;

export type PetSpeciesId = (typeof PET_SPECIES_IDS)[number];

export const DEFAULT_PET_SPECIES: PetSpeciesId = "mochi";

/** The molt-exclusive species — only a pet that has molted may wear it. */
export const PRESTIGE_PET_SPECIES: PetSpeciesId = "ember";

export function isPetSpeciesId(value: unknown): value is PetSpeciesId {
  return typeof value === "string" && (PET_SPECIES_IDS as readonly string[]).includes(value);
}

/** Whether a species is selectable at this prestige (molt count). */
export function isPetSpeciesUnlocked(species: PetSpeciesId, prestige: number): boolean {
  return species !== PRESTIGE_PET_SPECIES || prestige >= 1;
}

export const PET_SIZE_IDS = ["s", "m", "l"] as const;

export type PetSizeId = (typeof PET_SIZE_IDS)[number];

export const DEFAULT_PET_SIZE: PetSizeId = "m";

export function isPetSizeId(value: unknown): value is PetSizeId {
  return typeof value === "string" && (PET_SIZE_IDS as readonly string[]).includes(value);
}

/** Which bottom corner the pet homes in — placement preference, not identity. */
export const PET_HOME_SIDE_IDS = ["left", "right"] as const;

export type PetHomeSide = (typeof PET_HOME_SIDE_IDS)[number];

/** Historical default: bottom-right, matching the pre-setting layout. */
export const DEFAULT_PET_HOME_SIDE: PetHomeSide = "right";

export function isPetHomeSide(value: unknown): value is PetHomeSide {
  return typeof value === "string" && (PET_HOME_SIDE_IDS as readonly string[]).includes(value);
}

/** Lifetime counters, only ever incremented by real work (never decremented). */
export type PetLifetimeStats = {
  sessions: number;
  longSessions: number;
  ships: number;
  prs: number;
  memories: number;
  failures: number;
  worstStreak: number;
  /** Times the user petted (XP-granting pettings, not every click). */
  pets: number;
};

/** Rolling weekly counters for the Friday recap; reset on week rollover. */
export type PetWeeklyStats = {
  /** Monday 00:00 local of the week these counts belong to. */
  weekStart: number;
  sessions: number;
  ships: number;
  prs: number;
  failures: number;
};

/** XP earned per project — the pet develops a favorite from real work. */
export type PetProjectXp = Record<string, { name: string; xp: number }>;

/**
 * Full pet state pushed from the main window — the single source of truth for
 * the pet — to the desktop overlay window, which only renders it. `snapshot`
 * is the main store's PetSnapshot, opaque at the bridge (that type lives in
 * the renderer); both windows run the same bundle, so the shape always matches.
 *
 * `identity` (personality, lifetime/weekly stats, project-XP map, hatch date)
 * changes far less often than the snapshot, so the bridge omits it on the
 * frequent snapshot-only pushes (wander, flourish, stroke) and sends it only
 * when its reference actually changed. An omitted key means "identity
 * unchanged" — the overlay keeps the one it already holds.
 */
export type PetOverlayMirrorPayload = {
  snapshot: unknown;
  identity?: PetPersistentState | null;
  /**
   * Monotonic sequence stamped by the main process on every relay. Electron
   * gives no ordering guarantee between an `invoke` reply (getMirror) and `on`
   * pushes (mirror events), so a late getMirror reply could otherwise clobber a
   * newer live push. The overlay drops any payload whose seq is not greater than
   * the last it applied. Absent only on payloads that never crossed the relay.
   */
  seq?: number;
};

/**
 * A user interaction on the desktop pet, forwarded overlay → main window so
 * the authoritative store reacts (and the resulting state mirrors back).
 * `interact.alert` marks a click on an alerted pet — the jump-to-session
 * shortcut, the one action allowed to surface the main window.
 */
export type PetOverlayAction =
  | { kind: "interact"; alert: boolean }
  | { kind: "stroke" }
  | { kind: "grabbed"; x: number }
  | { kind: "tossed"; x: number }
  | { kind: "stats-open"; open: boolean }
  | { kind: "molt" };

export type PetPersistentState = {
  version: 1;
  name: string;
  species: PetSpeciesId;
  size: PetSizeId;
  xp: number;
  level: number;
  /**
   * Molt count. At the level cap the pet may molt: XP and level reset, this
   * increments, and everything lived-in (stats, drift, favorite project,
   * hatch date) survives. Permanent — the star badge never comes off.
   */
  prestige: number;
  /**
   * Effective personality — what line-picking reads. Always equals
   * effectivePersonality(personalityBase, personalityDrift); kept denormalized
   * so older consumers (and the settings page) need no drift math.
   */
  personality: PetPersonality;
  /** The install's rolled-once personality; drift never mutates it. */
  personalityBase: PetPersonality;
  /**
   * Slow experience-driven drift, per stat, clamped to ±PET_DRIFT_LIMIT.
   * Fractional — surviving error streaks nudges snark, marathons nudge zen —
   * so the character stays the one you rolled, just lived-in.
   */
  personalityDrift: PetPersonality;
  stats: PetLifetimeStats;
  weekly: PetWeeklyStats;
  projectXp: PetProjectXp;
  createdAt: number;
};

export const DEFAULT_PET_NAME = "Pixel";

const MAX_PET_NAME_LEN = 24;
const STAT_KEYS = ["snark", "wisdom", "chaos", "zen"] as const;

/** How far experience may drift a stat from its rolled base, either way. */
export const PET_DRIFT_LIMIT = 2;
/** Keep only this many projects in the XP map (top earners survive). */
const PROJECT_XP_MAX_ENTRIES = 12;
/** A favorite needs at least this much XP and a strict lead over #2. */
const FAVORITE_MIN_XP = 15;

/** Cumulative XP required to reach each level (index 0 = level 1). */
const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 800, 1200, 1700, 2300, 3000] as const;
export const PET_MAX_LEVEL = LEVEL_THRESHOLDS.length;

/**
 * Ceiling on persisted XP. Real work can't get anywhere near this within one
 * prestige (the cap sits at 3000), so anything larger is a corrupt or
 * hand-edited payload — clamp it instead of storing absurd magnitudes.
 */
export const MAX_PET_XP = 1_000_000;

/**
 * Levels where the sprite gains a permanent visible detail: the growing
 * sparkle at 3, a scarf at 5, a tool belt at 8, a tiny crown at the cap.
 * The store announces these with their own trigger instead of the plain
 * level-up line; the sprite gates the matching SVG layer on `level`.
 */
export const PET_EVOLUTION_LEVELS: ReadonlySet<number> = new Set([3, 5, 8, 10]);

/** Small deterministic PRNG so a caller can roll a reproducible personality. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollPetPersonality(rand: () => number = Math.random): PetPersonality {
  const roll = () => Math.floor(rand() * 11);
  return { snark: roll(), wisdom: roll(), chaos: roll(), zen: roll() };
}

export function createEmptyLifetimeStats(): PetLifetimeStats {
  return {
    sessions: 0,
    longSessions: 0,
    ships: 0,
    prs: 0,
    memories: 0,
    failures: 0,
    worstStreak: 0,
    pets: 0,
  };
}

/** Monday 00:00 local time of the week containing `now`. */
export function startOfWeek(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday; shift so Monday starts the week.
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

export function createEmptyWeeklyStats(now: number = Date.now()): PetWeeklyStats {
  return { weekStart: startOfWeek(now), sessions: 0, ships: 0, prs: 0, failures: 0 };
}

const ZERO_DRIFT: PetPersonality = { snark: 0, wisdom: 0, chaos: 0, zen: 0 };

/** base + rounded drift, clamped into the 0–10 stat range. */
export function effectivePersonality(
  base: PetPersonality,
  drift: PetPersonality,
): PetPersonality {
  const out = {} as PetPersonality;
  for (const key of STAT_KEYS) {
    out[key] = Math.min(10, Math.max(0, base[key] + Math.round(drift[key])));
  }
  return out;
}

/** Nudge drift stats by fractional amounts, clamped to ±PET_DRIFT_LIMIT. */
export function applyPersonalityDrift(
  drift: PetPersonality,
  nudge: Partial<PetPersonality>,
): PetPersonality {
  const out = { ...drift };
  for (const key of STAT_KEYS) {
    const amount = nudge[key];
    if (!amount) continue;
    out[key] = Math.min(PET_DRIFT_LIMIT, Math.max(-PET_DRIFT_LIMIT, out[key] + amount));
  }
  return out;
}

/** Add project XP, keeping only the top PROJECT_XP_MAX_ENTRIES earners. */
export function bumpProjectXp(
  projectXp: PetProjectXp,
  projectId: string,
  name: string,
  amount: number,
): PetProjectXp {
  const prev = projectXp[projectId];
  const next: PetProjectXp = {
    ...projectXp,
    [projectId]: { name: name || prev?.name || "a project", xp: (prev?.xp ?? 0) + amount },
  };
  const ids = Object.keys(next);
  if (ids.length > PROJECT_XP_MAX_ENTRIES) {
    ids.sort((a, b) => next[b].xp - next[a].xp);
    for (const id of ids.slice(PROJECT_XP_MAX_ENTRIES)) delete next[id];
  }
  return next;
}

/**
 * The pet's favorite project: the top XP earner, but only once it has real
 * history (≥ FAVORITE_MIN_XP) and a strict lead over the runner-up — a fresh
 * install has no favorites yet.
 */
export function favoriteProjectOf(
  projectXp: PetProjectXp,
): { projectId: string; name: string; xp: number } | null {
  let top: { projectId: string; name: string; xp: number } | null = null;
  let second = 0;
  for (const [projectId, entry] of Object.entries(projectXp)) {
    if (!top || entry.xp > top.xp) {
      second = top?.xp ?? 0;
      top = { projectId, ...entry };
    } else if (entry.xp > second) {
      second = entry.xp;
    }
  }
  if (!top || top.xp < FAVORITE_MIN_XP || top.xp <= second) return null;
  return top;
}

export function createDefaultPetState(now: number = Date.now()): PetPersistentState {
  const personality = rollPetPersonality();
  return {
    version: 1,
    name: DEFAULT_PET_NAME,
    species: DEFAULT_PET_SPECIES,
    size: DEFAULT_PET_SIZE,
    xp: 0,
    level: 1,
    prestige: 0,
    personality,
    personalityBase: personality,
    personalityDrift: { ...ZERO_DRIFT },
    stats: createEmptyLifetimeStats(),
    weekly: createEmptyWeeklyStats(now),
    projectXp: {},
    createdAt: now,
  };
}

export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

/** Cumulative XP needed for the next level, or null at the cap. */
export function xpForNextLevel(level: number): number | null {
  if (level >= PET_MAX_LEVEL) return null;
  return LEVEL_THRESHOLDS[level];
}

/**
 * Molt: begin again at level 1 with a permanent star. Only XP and level
 * reset — lifetime stats, personality (base + drift), project affection, and
 * the hatch date all carry across. Returns the state unchanged below the cap.
 */
export function moltPetState(state: PetPersistentState): PetPersistentState {
  if (state.level < PET_MAX_LEVEL) return state;
  return { ...state, xp: 0, level: 1, prestige: state.prestige + 1 };
}

function clampStat(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(10, Math.max(0, Math.round(value)));
}

/** Drift stats are fractional and signed; anything malformed reads as 0. */
function clampDriftStat(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(PET_DRIFT_LIMIT, Math.max(-PET_DRIFT_LIMIT, value));
}

/** Counters are non-negative integers; anything malformed reads as 0. */
function clampCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizePersonalityLike(
  value: unknown,
  clamp: (v: unknown) => number,
): PetPersonality {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = {} as PetPersonality;
  for (const key of STAT_KEYS) out[key] = clamp(raw[key]);
  return out;
}

function normalizeLifetimeStats(value: unknown): PetLifetimeStats {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const empty = createEmptyLifetimeStats();
  const out = {} as PetLifetimeStats;
  for (const key of Object.keys(empty) as (keyof PetLifetimeStats)[]) {
    out[key] = clampCount(raw[key]);
  }
  return out;
}

function normalizeWeeklyStats(value: unknown, now: number): PetWeeklyStats {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const weekStart =
    typeof raw.weekStart === "number" && Number.isFinite(raw.weekStart) && raw.weekStart > 0
      ? raw.weekStart
      : startOfWeek(now);
  return {
    weekStart,
    sessions: clampCount(raw.sessions),
    ships: clampCount(raw.ships),
    prs: clampCount(raw.prs),
    failures: clampCount(raw.failures),
  };
}

function normalizeProjectXp(value: unknown): PetProjectXp {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PetProjectXp = {};
  for (const [projectId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const { name, xp } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) continue;
    if (typeof xp !== "number" || !Number.isFinite(xp) || xp <= 0) continue;
    out[projectId] = { name: name.trim().slice(0, 64), xp: Math.floor(xp) };
  }
  return out;
}

/**
 * Validate a persisted (or PATCHed) pet state. Returns null on anything that
 * is not recoverably pet-shaped; clamps stats/xp/name into range otherwise.
 */
export function normalizePetState(value: unknown): PetPersistentState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const personalityRaw = raw.personality;
  if (!personalityRaw || typeof personalityRaw !== "object" || Array.isArray(personalityRaw)) {
    return null;
  }
  const personality = {} as PetPersonality;
  for (const key of STAT_KEYS) {
    const stat = clampStat((personalityRaw as Record<string, unknown>)[key]);
    if (stat === null) return null;
    personality[key] = stat;
  }

  const xpRaw = raw.xp;
  if (typeof xpRaw !== "number" || !Number.isFinite(xpRaw)) return null;
  const xp = Math.min(MAX_PET_XP, Math.max(0, Math.floor(xpRaw)));

  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, MAX_PET_NAME_LEN)
      : DEFAULT_PET_NAME;

  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) && raw.createdAt > 0
      ? raw.createdAt
      : Date.now();

  // States persisted before prestige existed have never molted.
  const prestige = clampCount(raw.prestige);

  // States persisted before the species picker existed default to Mochi. A
  // prestige species on a never-molted state (a hand-edited or stale payload)
  // falls back too — the unlock is earned, not typed in.
  const speciesRaw = isPetSpeciesId(raw.species) ? raw.species : DEFAULT_PET_SPECIES;
  const species = isPetSpeciesUnlocked(speciesRaw, prestige) ? speciesRaw : DEFAULT_PET_SPECIES;
  // States persisted before the size picker existed default to medium.
  const size = isPetSizeId(raw.size) ? raw.size : DEFAULT_PET_SIZE;

  // States persisted before drift existed treat the stored personality as the
  // rolled base; drift starts at zero, so effective == stored, unchanged.
  const personalityBase = raw.personalityBase
    ? normalizePersonalityLike(raw.personalityBase, (v) => clampStat(v) ?? 0)
    : personality;
  const personalityDrift = normalizePersonalityLike(raw.personalityDrift, clampDriftStat);

  return {
    version: 1,
    name,
    species,
    size,
    xp,
    level: levelForXp(xp),
    prestige,
    personality: effectivePersonality(personalityBase, personalityDrift),
    personalityBase,
    personalityDrift,
    stats: normalizeLifetimeStats(raw.stats),
    weekly: normalizeWeeklyStats(raw.weekly, Date.now()),
    projectXp: normalizeProjectXp(raw.projectXp),
    createdAt,
  };
}

/**
 * Guard a full-state write against a stale writer. Every renderer window
 * (main shell, focus mode) holds its own copy of the pet, hydrated once at
 * boot, and blind-writes it back on change — so a window that hydrated before
 * a molt or a level-up in another window would revert that progression
 * wholesale. Progression is monotonic within a life, so merge accordingly:
 *
 * - prestige only ever climbs; a lower-prestige write is a stale window, keep
 *   the stored progression and adopt only its freely-editable identity bits.
 * - at equal prestige, XP only accrues, so the larger XP wins; lifetime
 *   counters never decrease, so take the per-field max.
 * - name and size follow the incoming write (the settings page edits them);
 *   species follows it too when the unlock allows.
 */
export function mergePetStateWrite(
  stored: PetPersistentState | null,
  incoming: PetPersistentState,
): PetPersistentState {
  if (!stored) return incoming;
  // A molt just landed: the molter's write is the new truth wholesale.
  if (incoming.prestige > stored.prestige) return incoming;

  // Lifetime counters survive molts, so they merge per-field regardless of
  // which side's prestige wins.
  const stats = { ...incoming.stats };
  for (const key of Object.keys(stats) as (keyof PetLifetimeStats)[]) {
    stats[key] = Math.max(stats[key], stored.stats[key]);
  }
  // Same week: counters only accrue, take the max; otherwise the newer
  // weekStart's counters win.
  let weekly = incoming.weekly;
  if (stored.weekly.weekStart === incoming.weekly.weekStart) {
    weekly = {
      weekStart: incoming.weekly.weekStart,
      sessions: Math.max(stored.weekly.sessions, incoming.weekly.sessions),
      ships: Math.max(stored.weekly.ships, incoming.weekly.ships),
      prs: Math.max(stored.weekly.prs, incoming.weekly.prs),
      failures: Math.max(stored.weekly.failures, incoming.weekly.failures),
    };
  } else if (stored.weekly.weekStart > incoming.weekly.weekStart) {
    weekly = stored.weekly;
  }
  // Project affection only accrues too — union, per-project max.
  const projectXp: PetProjectXp = { ...incoming.projectXp };
  for (const [projectId, entry] of Object.entries(stored.projectXp)) {
    const mine = projectXp[projectId];
    if (!mine || entry.xp > mine.xp) projectXp[projectId] = entry;
  }
  const createdAt = Math.min(stored.createdAt, incoming.createdAt);

  if (incoming.prestige < stored.prestige) {
    // Stale window: keep the stored progression (prestige, xp, level); adopt
    // only the freely-editable identity bits and the merged accruals.
    const species = isPetSpeciesUnlocked(incoming.species, stored.prestige)
      ? incoming.species
      : stored.species;
    return {
      ...stored,
      name: incoming.name,
      size: incoming.size,
      species,
      stats,
      weekly,
      projectXp,
      createdAt,
    };
  }

  const xp = Math.max(stored.xp, incoming.xp);
  return {
    ...incoming,
    xp,
    level: levelForXp(xp),
    stats,
    weekly,
    projectXp,
    createdAt,
  };
}
