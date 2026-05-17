import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// file-handlers.ts imports electron + electron-log at module load. Both must be
// mocked before the import resolves.
vi.mock("electron", () => ({
  ipcMain: {},
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

import { isSensitiveAbs, isSensitiveRelPath } from "../file-handlers";

describe("isSensitiveRelPath", () => {
  it("rejects empty input", () => {
    expect(isSensitiveRelPath("")).toBe(false);
  });

  it.each([
    // .claude
    ".claude/settings.local.json",
    ".claude/settings.json",
    ".claude/hooks/post-stop.sh",
    // .codex / .cursor
    ".codex/hooks.json",
    ".cursor/hooks.json",
    // .git hooks
    ".git/hooks/post-checkout",
    ".git/hooks/pre-commit",
    ".git/config",
    // .husky
    ".husky/pre-commit",
    // IDE
    ".vscode/tasks.json",
    ".vscode/launch.json",
    ".devcontainer/devcontainer.json",
    // direnv
    ".envrc",
    // package manifests / lockfiles at the project root
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    // nested hooks dir under a non-dotted root
    "config/hooks/post-install.sh",
    // nested dotfiled dirs (deeper than root)
    "packages/foo/.claude/settings.local.json",
  ])("flags %s as sensitive", (p) => {
    expect(isSensitiveRelPath(p)).toBe(true);
  });

  it.each([
    "src/index.ts",
    "src/components/Btn.tsx",
    "README.md",
    "todos/bugs/06-files-write-can-plant-agent-hooks.md",
    "docs/architecture.md",
    // nested package.json that isn't at root is still risky for npm hoisting,
    // but the policy here only matches package.json at the project root.
    // Anything nested under a non-sensitive directory passes through.
    "packages/foo/src/index.ts",
    // Files whose name *contains* "package.json" but isn't exactly that.
    "package.json.bak",
    "scripts/build-package.json.ts",
  ])("treats %s as a normal file", (p) => {
    expect(isSensitiveRelPath(p)).toBe(false);
  });

  it("normalizes leading slashes", () => {
    expect(isSensitiveRelPath("/.claude/settings.local.json")).toBe(true);
    expect(isSensitiveRelPath("/src/index.ts")).toBe(false);
  });

  // macOS APFS is case-insensitive by default — `.Claude` resolves to the same
  // OS object as `.claude`. The classifier must reject every case variant.
  it.each([
    ".Claude/settings.local.json",
    ".CLAUDE/settings.local.json",
    ".GIT/hooks/post-checkout",
    ".Git/HOOKS/post-checkout",
    ".Husky/pre-commit",
    "Package.json",
    "PACKAGE.JSON",
    "Pnpm-Lock.YAML",
    ".VSCode/tasks.json",
  ])("flags %s (case variant) as sensitive", (p) => {
    expect(isSensitiveRelPath(p)).toBe(true);
  });

  it("rejects empty-segment-only inputs", () => {
    expect(isSensitiveRelPath("/")).toBe(false);
    expect(isSensitiveRelPath("///")).toBe(false);
  });
});

describe("isSensitiveAbs (post-resolve check)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-file-handlers-"));
    fs.mkdirSync(path.join(root, ".git", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\n");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "index.ts"), "// ok\n");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("flags a path that traverses into .git/hooks via `..` segments", () => {
    // The renderer-side string would not match the deny-list segment-wise
    // (it has `..` segments), but `path.resolve` collapses them so the abs
    // lands inside .git/hooks/. The post-resolve check catches it.
    const abs = path.resolve(root, "src/../.git/hooks/post-checkout");
    expect(isSensitiveAbs(root, abs)).toBe(true);
  });

  it("flags an existing symlink that points into .git/hooks", () => {
    // docs/readme.md → .git/hooks/pre-commit. A renderer asking to write
    // `docs/readme.md` would resolve through the symlink and land on a hook.
    fs.mkdirSync(path.join(root, "docs"));
    fs.symlinkSync(
      path.join(root, ".git", "hooks", "pre-commit"),
      path.join(root, "docs", "readme.md"),
    );
    const abs = path.resolve(root, "docs/readme.md");
    expect(isSensitiveAbs(root, abs)).toBe(true);
  });

  it("allows an ordinary source file", () => {
    const abs = path.resolve(root, "src/index.ts");
    expect(isSensitiveAbs(root, abs)).toBe(false);
  });

  it("flags a fresh write target inside .claude/ even if file doesn't exist yet", () => {
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    const abs = path.resolve(root, ".claude/settings.local.json");
    // File does not exist — realRel will be null, normalized path catches it.
    expect(fs.existsSync(abs)).toBe(false);
    expect(isSensitiveAbs(root, abs)).toBe(true);
  });
});
