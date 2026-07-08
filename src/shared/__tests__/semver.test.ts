import { describe, expect, it } from "vitest";
import { isNewerSemver, stripVersionPrefix, versionCore } from "../semver";

describe("stripVersionPrefix", () => {
  it("removes a leading v prefix", () => {
    expect(stripVersionPrefix("v1.2.3")).toBe("1.2.3");
    expect(stripVersionPrefix("V0.48.4")).toBe("0.48.4");
  });

  it("trims surrounding whitespace", () => {
    expect(stripVersionPrefix("  v1.0.0  ")).toBe("1.0.0");
  });
});

describe("versionCore", () => {
  it("drops prerelease and build suffixes", () => {
    expect(versionCore("v1.2.3-beta.1")).toBe("1.2.3");
    expect(versionCore("2026.05.20-2b5dd59")).toBe("2026.05.20");
    expect(versionCore("1.0.0+build.42")).toBe("1.0.0");
  });
});

describe("isNewerSemver", () => {
  it("compares normalized semver triplets", () => {
    expect(isNewerSemver("v0.49.0", "0.48.4")).toBe(true);
    expect(isNewerSemver("0.48.4", "0.48.4")).toBe(false);
    expect(isNewerSemver("0.48.3", "0.48.4")).toBe(false);
  });
});
