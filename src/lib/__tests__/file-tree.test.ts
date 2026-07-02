import { describe, expect, it } from "vitest";
import { buildFilePathTree, flattenFilePathTree } from "../file-tree";

describe("buildFilePathTree", () => {
  it("groups paths into sorted directory nodes", () => {
    expect(
      buildFilePathTree([
        "src/components/FileFinderDialog.tsx",
        "README.md",
        "src/lib/file-fuzzy.ts",
      ]),
    ).toEqual([
      {
        kind: "dir",
        name: "src",
        path: "src",
        fileCount: 2,
        children: [
          {
            kind: "dir",
            name: "components",
            path: "src/components",
            fileCount: 1,
            children: [
              {
                kind: "file",
                name: "FileFinderDialog.tsx",
                path: "src/components/FileFinderDialog.tsx",
              },
            ],
          },
          {
            kind: "dir",
            name: "lib",
            path: "src/lib",
            fileCount: 1,
            children: [
              {
                kind: "file",
                name: "file-fuzzy.ts",
                path: "src/lib/file-fuzzy.ts",
              },
            ],
          },
        ],
      },
      { kind: "file", name: "README.md", path: "README.md" },
    ]);
  });
});

describe("flattenFilePathTree", () => {
  it("returns visible files in tree order", () => {
    const tree = buildFilePathTree([
      "src/lib/file-fuzzy.ts",
      "README.md",
      "src/components/FileFinderDialog.tsx",
    ]);

    expect(flattenFilePathTree(tree)).toEqual([
      "src/components/FileFinderDialog.tsx",
      "src/lib/file-fuzzy.ts",
      "README.md",
    ]);
  });

  it("omits files inside collapsed folders", () => {
    const tree = buildFilePathTree([
      "src/lib/file-fuzzy.ts",
      "src/components/FileFinderDialog.tsx",
      "README.md",
    ]);

    expect(flattenFilePathTree(tree, new Set(["src"]))).toEqual(["README.md"]);
  });
});
