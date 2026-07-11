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

export const PET_SPECIES_IDS = ["mochi", "bunny", "chick", "cub", "lotl", "rivet", "trundle"] as const;

export type PetSpeciesId = (typeof PET_SPECIES_IDS)[number];

export const DEFAULT_PET_SPECIES: PetSpeciesId = "mochi";

export function isPetSpeciesId(value: unknown): value is PetSpeciesId {
  return typeof value === "string" && (PET_SPECIES_IDS as readonly string[]).includes(value);
}

export type PetPersistentState = {
  version: 1;
  name: string;
  species: PetSpeciesId;
  xp: number;
  level: number;
  personality: PetPersonality;
  createdAt: number;
};

export const DEFAULT_PET_NAME = "Pixel";

const MAX_PET_NAME_LEN = 24;
const STAT_KEYS = ["snark", "wisdom", "chaos", "zen"] as const;

/** Cumulative XP required to reach each level (index 0 = level 1). */
const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 800, 1200, 1700, 2300, 3000] as const;
export const PET_MAX_LEVEL = LEVEL_THRESHOLDS.length;

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

export function createDefaultPetState(now: number = Date.now()): PetPersistentState {
  return {
    version: 1,
    name: DEFAULT_PET_NAME,
    species: DEFAULT_PET_SPECIES,
    xp: 0,
    level: 1,
    personality: rollPetPersonality(),
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

function clampStat(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(10, Math.max(0, Math.round(value)));
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
  const xp = Math.max(0, Math.floor(xpRaw));

  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, MAX_PET_NAME_LEN)
      : DEFAULT_PET_NAME;

  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) && raw.createdAt > 0
      ? raw.createdAt
      : Date.now();

  // States persisted before the species picker existed default to Mochi.
  const species = isPetSpeciesId(raw.species) ? raw.species : DEFAULT_PET_SPECIES;

  return { version: 1, name, species, xp, level: levelForXp(xp), personality, createdAt };
}
