import { describe, expect, it } from "vitest";
import { fuzzyScore, rankFiles } from "../file-fuzzy";

describe("fuzzyScore", () => {
  it("matches exact basename higher than path-anywhere", () => {
    const a = fuzzyScore("env", ".env");
    const b = fuzzyScore("env", "src/lib/environment.ts");
    expect(a).toBeGreaterThan(b);
  });

  it("matches hidden dotfiles", () => {
    expect(fuzzyScore(".env", ".env")).toBeGreaterThan(0);
    expect(fuzzyScore("env", ".env")).toBeGreaterThan(0);
  });

  it("returns 0 when no subsequence match", () => {
    expect(fuzzyScore("zzz", "foo/bar.ts")).toBe(0);
  });

  it("ranks subsequence matches", () => {
    expect(fuzzyScore("pjs", "package.json")).toBeGreaterThan(0);
  });

  it("empty query returns positive", () => {
    expect(fuzzyScore("", "anything")).toBeGreaterThan(0);
  });
});

describe("rankFiles", () => {
  const files = [
    "package.json",
    "src/lib/file-fuzzy.ts",
    ".env",
    ".env.local",
    "src/components/views/FileFinderDialog.tsx",
    "README.md",
    "src/db/schema.ts",
  ];

  it("ranks shorter exact matches first", () => {
    const r = rankFiles("env", files);
    expect(r[0].path).toBe(".env");
    expect(r[1].path).toBe(".env.local");
  });

  it("returns all files when query is empty", () => {
    const r = rankFiles("", files);
    expect(r.length).toBe(files.length);
  });

  it("excludes non-matches", () => {
    const r = rankFiles("xyzabc", files);
    expect(r.length).toBe(0);
  });

  it("respects limit", () => {
    const r = rankFiles("", files, 2);
    expect(r.length).toBe(2);
  });

  it("finds package.json by basename substring", () => {
    const r = rankFiles("packa", files);
    expect(r[0].path).toBe("package.json");
  });
});
