import { describe, it, expect } from "vitest";
import {
  parsePorcelainZ,
  changedFileCount,
  classifyDiffPatch,
  buildAdditionsDiff,
  isBinaryPatch,
  mapStatusCode,
  bufferLooksBinary,
} from "../git-status";

describe("parsePorcelainZ", () => {
  it("splits staged vs unstaged and untracked", () => {
    // "M  a" = staged modify; " M b" = unstaged modify; "?? c" = untracked
    const out = parsePorcelainZ("M  a\0 M b\0?? c\0");
    expect(out.staged).toEqual([{ path: "a", origPath: undefined, status: "modified" }]);
    expect(out.unstaged).toEqual([
      { path: "b", status: "modified" },
      { path: "c", status: "untracked" },
    ]);
  });

  it("pairs the original path for renames", () => {
    const out = parsePorcelainZ("R  new\0old\0");
    expect(out.staged).toEqual([{ path: "new", origPath: "old", status: "renamed" }]);
  });

  it("returns empty for an empty status", () => {
    expect(parsePorcelainZ("")).toEqual({ staged: [], unstaged: [] });
  });
});

describe("changedFileCount", () => {
  it("counts unique paths across staged + unstaged", () => {
    expect(
      changedFileCount(
        [{ path: "a", status: "modified" }],
        [
          { path: "a", status: "modified" },
          { path: "b", status: "untracked" },
        ],
      ),
    ).toBe(2);
  });
});

describe("mapStatusCode", () => {
  it("maps porcelain codes to enum values", () => {
    expect(mapStatusCode("A")).toBe("added");
    expect(mapStatusCode("D")).toBe("deleted");
    expect(mapStatusCode("?")).toBe("untracked");
    expect(mapStatusCode("Z")).toBe("modified"); // unknown → modified
  });
});

describe("classifyDiffPatch", () => {
  it("classifies empty, binary, and text", () => {
    expect(classifyDiffPatch("   ")).toEqual({ kind: "empty" });
    expect(classifyDiffPatch("Binary files a/x and b/x differ")).toEqual({ kind: "binary" });
    expect(classifyDiffPatch("@@ -1 +1 @@\n-a\n+b\n")).toEqual({
      kind: "text",
      patch: "@@ -1 +1 @@\n-a\n+b\n",
      truncated: false,
    });
  });

  it("flags too-large patches by byte cap", () => {
    const big = "x".repeat(2 * 1024 * 1024 + 10);
    const result = classifyDiffPatch(big);
    expect(result.kind).toBe("too-large");
  });
});

describe("bufferLooksBinary", () => {
  it("detects NUL bytes in the sniff window", () => {
    expect(bufferLooksBinary(new Uint8Array([0x41, 0x00, 0x42]))).toBe(true);
    expect(bufferLooksBinary(new Uint8Array([0x41, 0x42, 0x43]))).toBe(false);
  });

  it("only scans the first BUFFER_BINARY_SNIFF_BYTES", () => {
    const buf = new Uint8Array(8 * 1024 + 1);
    buf.fill(0x41);
    buf[8 * 1024] = 0;
    expect(bufferLooksBinary(buf)).toBe(false);
  });
});

describe("isBinaryPatch", () => {
  it("detects git binary markers", () => {
    expect(isBinaryPatch("GIT binary patch")).toBe(true);
    expect(isBinaryPatch("@@ -1 +1 @@")).toBe(false);
  });
});

describe("buildAdditionsDiff", () => {
  it("renders an untracked file as all-additions", () => {
    const patch = buildAdditionsDiff("new.txt", "line1\nline2");
    expect(patch).toContain("diff --git a/new.txt b/new.txt");
    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("+++ b/new.txt");
    expect(patch).toContain("@@ -0,0 +1,2 @@");
    expect(patch).toContain("+line1");
    expect(patch).toContain("+line2");
  });
});
