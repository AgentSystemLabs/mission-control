import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureDiagramSkillForAgent } from "../ensure-diagram-skill";

describe("ensureDiagramSkillForAgent", () => {
  it("installs the bundled diagram skill for cursor-cli when missing", () => {
    const appPath = process.cwd();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ensure-diagram-"));

    ensureDiagramSkillForAgent(appPath, cwd, "cursor-cli");

    expect(fs.existsSync(path.join(cwd, ".cursor", "skills", "diagram", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".agents", "skills", "diagram", "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(cwd, ".cursor", "skills", "diagram", "SKILL.md"), "utf8")).toContain(
      "POST $MC_API_URL/api/diagram",
    );
  });

  it("does not overwrite an existing project skill", () => {
    const appPath = process.cwd();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ensure-diagram-existing-"));
    const skillDir = path.join(cwd, ".cursor", "skills", "diagram");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "custom skill marker", "utf8");

    ensureDiagramSkillForAgent(appPath, cwd, "cursor-cli");

    expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8")).toBe("custom skill marker");
  });
});
