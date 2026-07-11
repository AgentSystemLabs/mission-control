import { describe, expect, it } from "vitest";
import {
  applyPersonalityDrift,
  bumpProjectXp,
  createDefaultPetState,
  createEmptyLifetimeStats,
  DEFAULT_PET_NAME,
  effectivePersonality,
  favoriteProjectOf,
  levelForXp,
  mulberry32,
  normalizePetState,
  PET_DRIFT_LIMIT,
  PET_MAX_LEVEL,
  rollPetPersonality,
  startOfWeek,
  xpForNextLevel,
  type PetProjectXp,
} from "../pet";

describe("levelForXp", () => {
  it("maps the documented thresholds", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(49)).toBe(1);
    expect(levelForXp(50)).toBe(2);
    expect(levelForXp(150)).toBe(3);
    expect(levelForXp(299)).toBe(3);
    expect(levelForXp(3000)).toBe(PET_MAX_LEVEL);
    expect(levelForXp(999_999)).toBe(PET_MAX_LEVEL);
  });

  it("xpForNextLevel returns the next threshold and null at the cap", () => {
    expect(xpForNextLevel(1)).toBe(50);
    expect(xpForNextLevel(2)).toBe(150);
    expect(xpForNextLevel(PET_MAX_LEVEL)).toBeNull();
  });
});

describe("rollPetPersonality", () => {
  it("is deterministic for a seeded PRNG and stays in range", () => {
    const a = rollPetPersonality(mulberry32(42));
    const b = rollPetPersonality(mulberry32(42));
    expect(a).toEqual(b);
    for (const value of Object.values(a)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(10);
    }
  });
});

describe("normalizePetState", () => {
  const valid = () => ({
    version: 1,
    name: "Draco",
    xp: 160,
    level: 1,
    personality: { snark: 7, wisdom: 4, chaos: 2, zen: 6 },
    createdAt: 1_700_000_000_000,
  });

  it("accepts a valid state and recomputes level from xp", () => {
    const result = normalizePetState(valid());
    expect(result).toMatchObject({ name: "Draco", xp: 160, level: 3 });
  });

  it("clamps out-of-range stats, negative xp, and long names", () => {
    const result = normalizePetState({
      ...valid(),
      xp: -50,
      name: "x".repeat(60),
      personality: { snark: 99, wisdom: -3, chaos: 5.6, zen: 10 },
    });
    expect(result).toMatchObject({
      xp: 0,
      level: 1,
      personality: { snark: 10, wisdom: 0, chaos: 6, zen: 10 },
    });
    expect(result!.name).toHaveLength(24);
  });

  it("falls back to the default name when blank", () => {
    expect(normalizePetState({ ...valid(), name: "   " })!.name).toBe(DEFAULT_PET_NAME);
  });

  it("keeps a valid species and defaults unknown/missing ones to mochi", () => {
    expect(normalizePetState({ ...valid(), species: "bunny" })!.species).toBe("bunny");
    expect(normalizePetState({ ...valid(), species: "rivet" })!.species).toBe("rivet");
    expect(normalizePetState({ ...valid(), species: "trundle" })!.species).toBe("trundle");
    expect(normalizePetState({ ...valid(), species: "goose" })!.species).toBe("mochi");
    expect(normalizePetState(valid())!.species).toBe("mochi"); // pre-picker state
  });

  it("keeps a valid size and defaults unknown/missing ones to medium", () => {
    expect(normalizePetState({ ...valid(), size: "s" })!.size).toBe("s");
    expect(normalizePetState({ ...valid(), size: "l" })!.size).toBe("l");
    expect(normalizePetState({ ...valid(), size: "xl" })!.size).toBe("m");
    expect(normalizePetState(valid())!.size).toBe("m"); // pre-picker state
  });

  it("rejects garbage", () => {
    expect(normalizePetState(null)).toBeNull();
    expect(normalizePetState("dragon")).toBeNull();
    expect(normalizePetState([])).toBeNull();
    expect(normalizePetState({})).toBeNull();
    expect(normalizePetState({ ...valid(), personality: null })).toBeNull();
    expect(normalizePetState({ ...valid(), personality: { snark: "high" } })).toBeNull();
    expect(normalizePetState({ ...valid(), xp: "many" })).toBeNull();
  });

  it("createDefaultPetState round-trips through normalize", () => {
    const state = createDefaultPetState(1_700_000_000_000);
    expect(normalizePetState(state)).toEqual(state);
  });

  it("upgrades a pre-drift state: base = personality, drift 0, empty stats", () => {
    const result = normalizePetState(valid())!;
    expect(result.personalityBase).toEqual(valid().personality);
    expect(result.personalityDrift).toEqual({ snark: 0, wisdom: 0, chaos: 0, zen: 0 });
    expect(result.personality).toEqual(valid().personality);
    expect(result.stats).toEqual(createEmptyLifetimeStats());
    expect(result.weekly.weekStart).toBe(startOfWeek(Date.now()));
    expect(result.projectXp).toEqual({});
  });

  it("recomputes effective personality from base + drift and clamps drift", () => {
    const result = normalizePetState({
      ...valid(),
      personalityBase: { snark: 7, wisdom: 4, chaos: 2, zen: 6 },
      personalityDrift: { snark: 99, wisdom: -99, chaos: 0.4, zen: "loud" },
    })!;
    expect(result.personalityDrift).toEqual({
      snark: PET_DRIFT_LIMIT,
      wisdom: -PET_DRIFT_LIMIT,
      chaos: 0.4,
      zen: 0,
    });
    // snark 7+2, wisdom 4-2, chaos 2+round(0.4)=2, zen 6+0.
    expect(result.personality).toEqual({ snark: 9, wisdom: 2, chaos: 2, zen: 6 });
  });

  it("filters malformed stats, weekly, and projectXp entries", () => {
    const result = normalizePetState({
      ...valid(),
      stats: { sessions: 4.9, ships: -3, prs: "many" },
      weekly: { weekStart: -5, sessions: 2 },
      projectXp: {
        good: { name: "mission-control", xp: 40 },
        noName: { name: "  ", xp: 10 },
        zeroXp: { name: "meh", xp: 0 },
        garbage: "nope",
      },
    })!;
    expect(result.stats.sessions).toBe(4);
    expect(result.stats.ships).toBe(0);
    expect(result.stats.prs).toBe(0);
    expect(result.weekly.weekStart).toBe(startOfWeek(Date.now()));
    expect(result.weekly.sessions).toBe(2);
    expect(result.projectXp).toEqual({ good: { name: "mission-control", xp: 40 } });
  });
});

describe("personality drift helpers", () => {
  const base = { snark: 5, wisdom: 5, chaos: 5, zen: 5 };

  it("effectivePersonality rounds drift and clamps into 0–10", () => {
    expect(
      effectivePersonality(
        { snark: 10, wisdom: 0, chaos: 5, zen: 5 },
        { snark: 2, wisdom: -2, chaos: 0.6, zen: -0.4 },
      ),
    ).toEqual({ snark: 10, wisdom: 0, chaos: 6, zen: 5 });
  });

  it("applyPersonalityDrift accumulates and clamps at the limit", () => {
    let drift = { snark: 0, wisdom: 0, chaos: 0, zen: 0 };
    for (let i = 0; i < 50; i++) drift = applyPersonalityDrift(drift, { snark: 0.2 });
    expect(drift.snark).toBe(PET_DRIFT_LIMIT);
    for (let i = 0; i < 50; i++) drift = applyPersonalityDrift(drift, { zen: -0.2 });
    expect(drift.zen).toBe(-PET_DRIFT_LIMIT);
    expect(drift.wisdom).toBe(0);
    expect(effectivePersonality(base, drift)).toEqual({ snark: 7, wisdom: 5, chaos: 5, zen: 3 });
  });
});

describe("startOfWeek", () => {
  it("returns the Monday 00:00 of any day in the week", () => {
    // 2026-07-11 is a Saturday; its week starts Monday 2026-07-06.
    const saturday = new Date(2026, 6, 11, 15, 30).getTime();
    const monday = new Date(2026, 6, 6, 0, 0, 0, 0).getTime();
    expect(startOfWeek(saturday)).toBe(monday);
    // A Monday is its own week start; a Sunday belongs to the prior Monday.
    expect(startOfWeek(monday)).toBe(monday);
    expect(startOfWeek(new Date(2026, 6, 12, 23, 0).getTime())).toBe(monday);
  });
});

describe("project xp + favorite", () => {
  it("bumpProjectXp accumulates per project and keeps only the top earners", () => {
    let xp: PetProjectXp = {};
    xp = bumpProjectXp(xp, "a", "Alpha", 5);
    xp = bumpProjectXp(xp, "a", "Alpha", 8);
    expect(xp.a).toEqual({ name: "Alpha", xp: 13 });
    for (let i = 0; i < 14; i++) xp = bumpProjectXp(xp, `p${i}`, `P${i}`, i + 1);
    expect(Object.keys(xp).length).toBe(12);
    // The biggest earner survives the cap; the tiniest ones are dropped.
    expect(xp.a).toBeDefined();
    expect(xp.p0).toBeUndefined();
  });

  it("favoriteProjectOf needs real history and a strict lead", () => {
    expect(favoriteProjectOf({})).toBeNull();
    // Not enough XP yet.
    expect(favoriteProjectOf({ a: { name: "Alpha", xp: 10 } })).toBeNull();
    // Tied — no favorite.
    expect(
      favoriteProjectOf({ a: { name: "Alpha", xp: 20 }, b: { name: "Beta", xp: 20 } }),
    ).toBeNull();
    expect(
      favoriteProjectOf({ a: { name: "Alpha", xp: 25 }, b: { name: "Beta", xp: 20 } }),
    ).toEqual({ projectId: "a", name: "Alpha", xp: 25 });
  });
});
