import { describe, expect, it } from "vitest";
import { compareCliVersions } from "../agent-cli-version-compare";

describe("compareCliVersions", () => {
  it("compares semver triplets numerically", () => {
    expect(compareCliVersions("2.1.146", "2.1.145")).toBeGreaterThan(0);
    expect(compareCliVersions("2.1.146", "2.1.146")).toBe(0);
    expect(compareCliVersions("0.9.9", "0.132.0")).toBeLessThan(0);
  });

  it("strips v prefixes and prerelease/build suffixes", () => {
    expect(compareCliVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareCliVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(compareCliVersions("1.2.4+build5", "1.2.3")).toBeGreaterThan(0);
  });

  it("treats missing segments as zero", () => {
    expect(compareCliVersions("1.2", "1.2.0")).toBe(0);
    expect(compareCliVersions("1.2.0.1", "1.2.0")).toBeGreaterThan(0);
  });

  it("compares only the date triplet for calendar-date builds", () => {
    expect(compareCliVersions("2026.05.20-2b5dd59", "2026.05.20", "calendar-date")).toBe(0);
    expect(compareCliVersions("2026.06.01-aaa", "2026.05.20-zzz", "calendar-date")).toBeGreaterThan(0);
    expect(compareCliVersions("2025.12.31", "2026.01.01", "calendar-date")).toBeLessThan(0);
  });
});
