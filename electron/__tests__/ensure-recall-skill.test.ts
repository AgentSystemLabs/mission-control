import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureRecallSkillForAgent, removeRecallSkillForAgent } from "../ensure-recall-skill";

// The repo root, where .agents/skills/recall lives (dev resolution).
const APP_PATH = path.resolve(__dirname, "..", "..");

function tmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mc-recall-skill-"));
}

function skillDir(cwd: string): string {
  return path.join(cwd, ".claude", "skills", "recall");
}

describe("ensureRecallSkillForAgent / removeRecallSkillForAgent", () => {
  it("installs the bundled skill, then removal deletes it", () => {
    const cwd = tmpCwd();
    ensureRecallSkillForAgent(APP_PATH, cwd, "claude-code");
    expect(fs.existsSync(path.join(skillDir(cwd), "SKILL.md"))).toBe(true);

    removeRecallSkillForAgent(cwd, "claude-code");
    expect(fs.existsSync(skillDir(cwd))).toBe(false);
  });

  it("removal spares a user-authored skill at the same path", () => {
    const cwd = tmpCwd();
    fs.mkdirSync(skillDir(cwd), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir(cwd), "SKILL.md"),
      "---\nname: recall\n---\n\nMy own note-taking skill.\n",
      "utf8",
    );
    removeRecallSkillForAgent(cwd, "claude-code");
    expect(fs.existsSync(path.join(skillDir(cwd), "SKILL.md"))).toBe(true);
  });

  it("removal is a no-op when nothing is installed", () => {
    const cwd = tmpCwd();
    expect(() => removeRecallSkillForAgent(cwd, "claude-code")).not.toThrow();
  });

  it("removal cleans both cursor skill locations", () => {
    const cwd = tmpCwd();
    ensureRecallSkillForAgent(APP_PATH, cwd, "cursor-cli");
    const cursorDir = path.join(cwd, ".cursor", "skills", "recall");
    const agentsDir = path.join(cwd, ".agents", "skills", "recall");
    expect(fs.existsSync(path.join(cursorDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(agentsDir, "SKILL.md"))).toBe(true);

    removeRecallSkillForAgent(cwd, "cursor-cli");
    expect(fs.existsSync(cursorDir)).toBe(false);
    expect(fs.existsSync(agentsDir)).toBe(false);
  });
});
