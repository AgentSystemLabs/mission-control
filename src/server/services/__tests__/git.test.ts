import { describe, it, expect } from "vitest";
import { parseBranchList, parsePorcelainZ, parseGitBranchHeader } from "../git";

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

describe("parseGitBranchHeader", () => {
  it("parses a branch with no upstream (counts fall back to null)", () => {
    expect(parseGitBranchHeader("## main")).toEqual({
      branch: "main",
      hasUpstream: false,
      ahead: null,
      behind: null,
    });
  });

  it("parses a branch with an upstream and no divergence (0/0)", () => {
    expect(parseGitBranchHeader("## main...origin/main")).toEqual({
      branch: "main",
      hasUpstream: true,
      ahead: 0,
      behind: 0,
    });
  });

  it("parses ahead-only counts", () => {
    expect(parseGitBranchHeader("## main...origin/main [ahead 2]")).toEqual({
      branch: "main",
      hasUpstream: true,
      ahead: 2,
      behind: 0,
    });
  });

  it("parses behind-only counts", () => {
    expect(parseGitBranchHeader("## main...origin/main [behind 3]")).toEqual({
      branch: "main",
      hasUpstream: true,
      ahead: 0,
      behind: 3,
    });
  });

  it("parses a diverged branch (ahead and behind)", () => {
    expect(parseGitBranchHeader("## feat/x...origin/feat/x [ahead 1, behind 4]")).toEqual({
      branch: "feat/x",
      hasUpstream: true,
      ahead: 1,
      behind: 4,
    });
  });

  it("reports HEAD for a detached checkout", () => {
    expect(parseGitBranchHeader("## HEAD (no branch)")).toEqual({
      branch: "HEAD",
      hasUpstream: false,
      ahead: null,
      behind: null,
    });
  });

  it("parses the unborn-branch header (no commits yet)", () => {
    expect(parseGitBranchHeader("## No commits yet on main")).toEqual({
      branch: "main",
      hasUpstream: false,
      ahead: null,
      behind: null,
    });
    // Older git phrasing.
    expect(parseGitBranchHeader("## Initial commit on trunk").branch).toBe("trunk");
  });

  it("keeps slashes in branch and upstream names", () => {
    const r = parseGitBranchHeader("## release/1.2...upstream/release/1.2 [ahead 5]");
    expect(r.branch).toBe("release/1.2");
    expect(r.hasUpstream).toBe(true);
    expect(r.ahead).toBe(5);
  });

  it("treats a [gone] upstream as no upstream so the caller falls back to origin/main", () => {
    // Remote branch deleted (e.g. PR merged + branch pruned). git still prints
    // the `...upstream` form for the name but no counts; reporting hasUpstream
    // here would falsely show the branch as in sync (0/0) instead of counting
    // it ahead of origin/main.
    expect(parseGitBranchHeader("## feature...origin/feature [gone]")).toEqual({
      branch: "feature",
      hasUpstream: false,
      ahead: null,
      behind: null,
    });
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
