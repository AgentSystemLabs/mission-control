import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveSafeOpenPath } from "../open-path-policy";

function mkdir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mc-open-path-${label}-`));
}

function writeFile(file: string, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "test", "utf8");
  if (mode !== undefined) fs.chmodSync(file, mode);
}

describe("resolveSafeOpenPath", () => {
  it("allows directories inside a registered project root", () => {
    const project = mkdir("project");
    const dir = path.join(project, "docs");
    fs.mkdirSync(dir);

    expect(resolveSafeOpenPath(dir, [project])).toEqual({
      ok: true,
      path: fs.realpathSync(dir),
    });
  });

  it("rejects ordinary files because this IPC is reveal-only", () => {
    const project = mkdir("project");
    const file = path.join(project, "README.md");
    writeFile(file);

    expect(resolveSafeOpenPath(file, [project])).toEqual({
      ok: false,
      error: "files-not-supported",
    });
  });

  it("rejects sibling-prefix paths outside the registered project root", () => {
    const project = mkdir("project");
    const sibling = `${project}-evil`;
    fs.mkdirSync(sibling);
    const file = path.join(sibling, "README.md");
    writeFile(file);

    expect(resolveSafeOpenPath(file, [project])).toEqual({
      ok: false,
      error: "path-outside-project-roots",
    });
  });

  it("rejects symlinks that resolve outside the registered project root", () => {
    const project = mkdir("project");
    const outside = mkdir("outside");
    const outsideFile = path.join(outside, "safe-looking.md");
    const link = path.join(project, "linked.md");
    writeFile(outsideFile);
    fs.symlinkSync(outsideFile, link);

    expect(resolveSafeOpenPath(link, [project])).toEqual({
      ok: false,
      error: "path-outside-project-roots",
    });
  });

  it("rejects executable and installer-style file extensions", () => {
    const project = mkdir("project");

    for (const name of ["tool.command", "installer.app", "setup.exe", "shortcut.lnk", "macro.docm"]) {
      const file = path.join(project, name);
      if (name.endsWith(".app")) fs.mkdirSync(file);
      else writeFile(file);

      expect(resolveSafeOpenPath(file, [project])).toEqual({
        ok: false,
        error: "dangerous-file-type",
      });
    }
  });

  it("rejects extensionless files instead of asking the OS to open them", () => {
    const project = mkdir("project");
    const file = path.join(project, "run-me");
    writeFile(file, 0o755);

    expect(resolveSafeOpenPath(file, [project])).toEqual({
      ok: false,
      error: "files-not-supported",
    });
  });
});
