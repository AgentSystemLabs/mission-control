import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  removeAgentMemoryFile,
  supportsMemoryInjection,
  writeAgentMemoryFile,
} from "../agent-memory-file";

function makeDir(prefix = "mc-memfile-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initGitRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
}

const BRIEF = "# Project memory\n\n## Overview\n- **A test project**";

describe("agent-memory-file writer", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeDir();
  });

  it("reports which agents support injection (Claude only in Phase 1)", () => {
    expect(supportsMemoryInjection("claude-code")).toBe(true);
    expect(supportsMemoryInjection("codex")).toBe(false);
    expect(supportsMemoryInjection(undefined)).toBe(false);
  });

  it("writes a marker-delimited block into CLAUDE.local.md", () => {
    const wrote = writeAgentMemoryFile("claude-code", cwd, BRIEF);
    expect(wrote).toBe(true);
    const content = fs.readFileSync(path.join(cwd, "CLAUDE.local.md"), "utf8");
    expect(content).toContain("<!-- mc:recall:start");
    expect(content).toContain("<!-- mc:recall:end -->");
    expect(content).toContain("A test project");
  });

  it("is idempotent — rewriting replaces the block, never duplicates it", () => {
    writeAgentMemoryFile("claude-code", cwd, BRIEF);
    writeAgentMemoryFile("claude-code", cwd, "# Project memory\n\n## Overview\n- **Updated**");
    const content = fs.readFileSync(path.join(cwd, "CLAUDE.local.md"), "utf8");
    expect(content.match(/mc:recall:start/g)).toHaveLength(1);
    expect(content).toContain("Updated");
    expect(content).not.toContain("A test project");
  });

  it("preserves pre-existing user content around the managed block", () => {
    const file = path.join(cwd, "CLAUDE.local.md");
    fs.writeFileSync(file, "# My notes\n\nkeep me\n", "utf8");
    writeAgentMemoryFile("claude-code", cwd, BRIEF);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("keep me");
    expect(content).toContain("A test project");
  });

  it("removes the block when given an empty brief, keeping user content", () => {
    const file = path.join(cwd, "CLAUDE.local.md");
    fs.writeFileSync(file, "# My notes\n\nkeep me\n", "utf8");
    writeAgentMemoryFile("claude-code", cwd, BRIEF);
    removeAgentMemoryFile("claude-code", cwd);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("keep me");
    expect(content).not.toContain("mc:recall");
  });

  it("no-ops for unsupported agents", () => {
    expect(writeAgentMemoryFile("codex", cwd, BRIEF)).toBe(false);
    expect(fs.existsSync(path.join(cwd, "CLAUDE.local.md"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "AGENTS.md"))).toBe(false);
  });

  it("ensures the file is git-ignored when the cwd is a git repo", () => {
    initGitRepo(cwd);
    writeAgentMemoryFile("claude-code", cwd, BRIEF);
    const gitignore = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
    expect(gitignore).toContain("CLAUDE.local.md");
    // Idempotent — a second write doesn't add a duplicate ignore line.
    writeAgentMemoryFile("claude-code", cwd, BRIEF);
    const again = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
    expect(again.match(/CLAUDE\.local\.md/g)).toHaveLength(1);
  });

  it("does not touch .gitignore when the cwd is not a git repo", () => {
    writeAgentMemoryFile("claude-code", cwd, BRIEF);
    expect(fs.existsSync(path.join(cwd, ".gitignore"))).toBe(false);
  });
});
