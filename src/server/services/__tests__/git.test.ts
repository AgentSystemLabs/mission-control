import { describe, it, expect } from "vitest";
import { parseBranchList, parsePorcelainZ } from "../git";

/** Build a porcelain-z stream from {x, y, path} entries. Renamed/copied entries
 *  carry an extra `from` field that emits a paired NUL-terminated path. */
function buildPorcelain(
  entries: { x: string; y: string; path: string; from?: string }[],
): string {
  const parts: string[] = [];
  for (const e of entries) {
    parts.push(`${e.x}${e.y} ${e.path}`);
    if (e.from) parts.push(e.from);
  }
  // Each record ends with NUL; final NUL closes the stream.
  return parts.join("\0") + "\0";
}

describe("parsePorcelainZ", () => {
  it("returns empty arrays for empty input", () => {
    expect(parsePorcelainZ("")).toEqual({ staged: [], unstaged: [] });
  });

  it("parses an untracked file as unstaged-only with status untracked", () => {
    const r = parsePorcelainZ(buildPorcelain([{ x: "?", y: "?", path: "new.ts" }]));
    expect(r.staged).toEqual([]);
    expect(r.unstaged).toEqual([{ path: "new.ts", status: "untracked" }]);
  });

  it("parses a staged-only modification (M )", () => {
    const r = parsePorcelainZ(buildPorcelain([{ x: "M", y: " ", path: "a.ts" }]));
    expect(r.staged).toEqual([{ path: "a.ts", origPath: undefined, status: "modified" }]);
    expect(r.unstaged).toEqual([]);
  });

  it("parses an unstaged-only deletion ( D)", () => {
    const r = parsePorcelainZ(buildPorcelain([{ x: " ", y: "D", path: "old.ts" }]));
    expect(r.staged).toEqual([]);
    expect(r.unstaged).toEqual([{ path: "old.ts", status: "deleted" }]);
  });

  it("parses a partially-staged file (MM) as both staged and unstaged", () => {
    const r = parsePorcelainZ(buildPorcelain([{ x: "M", y: "M", path: "shared.ts" }]));
    expect(r.staged).toEqual([
      { path: "shared.ts", origPath: undefined, status: "modified" },
    ]);
    expect(r.unstaged).toEqual([{ path: "shared.ts", status: "modified" }]);
  });

  it("parses a staged rename and consumes the paired old path", () => {
    const r = parsePorcelainZ(
      buildPorcelain([
        { x: "R", y: " ", path: "new/loc.ts", from: "old/loc.ts" },
        { x: "M", y: " ", path: "after.ts" },
      ]),
    );
    expect(r.staged).toEqual([
      { path: "new/loc.ts", origPath: "old/loc.ts", status: "renamed" },
      { path: "after.ts", origPath: undefined, status: "modified" },
    ]);
    expect(r.unstaged).toEqual([]);
  });

  it("handles paths with spaces", () => {
    const r = parsePorcelainZ(
      buildPorcelain([{ x: "M", y: " ", path: "dir name/has space.ts" }]),
    );
    expect(r.staged[0]?.path).toBe("dir name/has space.ts");
  });

  it("ignores trailing empty entries", () => {
    const r = parsePorcelainZ(
      buildPorcelain([{ x: "M", y: " ", path: "a.ts" }]) + "\0\0",
    );
    expect(r.staged).toHaveLength(1);
  });
});

describe("parseBranchList", () => {
  it("merges local and remote branches by short name", () => {
    expect(
      parseBranchList("main\nfeat/foo", "origin/main\norigin/feat/bar\norigin/HEAD -> origin/main"),
    ).toEqual([
      { name: "feat/bar", local: false, remoteRef: "origin/feat/bar" },
      { name: "feat/foo", local: true },
      { name: "main", local: true, remoteRef: "origin/main" },
    ]);
  });

  it("returns empty list for empty input", () => {
    expect(parseBranchList("", "")).toEqual([]);
  });
});
