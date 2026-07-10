import { describe, expect, it } from "vitest";
import {
  createDefaultPetState,
  DEFAULT_PET_NAME,
  levelForXp,
  mulberry32,
  normalizePetState,
  PET_MAX_LEVEL,
  rollPetPersonality,
  xpForNextLevel,
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
    expect(normalizePetState({ ...valid(), species: "goose" })!.species).toBe("mochi");
    expect(normalizePetState(valid())!.species).toBe("mochi"); // pre-picker state
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
});
