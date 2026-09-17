import * as path from "node:path";
import type { TaskAgent } from "../src/shared/domain";
import { findBundledSkillSource, installSkillWhereMissing } from "./skill-install-fs";
import {
  DIAGRAM_SKILL_INSTALL_TARGETS,
  type DiagramSkillHarness,
} from "../src/shared/diagram-skill-install";

const AGENT_HARNESS: Partial<Record<TaskAgent, DiagramSkillHarness>> = {
  "claude-code": "claude",
  codex: "codex",
  "cursor-cli": "cursor",
};

function bundledDiagramSkillSourceDirs(appPath: string): string[] {
  return [
    path.join(appPath, ".agents", "skills", "diagram"),
    path.join(appPath, "dist", "bundled-skills", "diagram"),
    path.join(appPath, "dist-server", "bundled-skills", "diagram"),
  ];
}

function diagramSkillTargetPaths(cwd: string, harness: DiagramSkillHarness): string[] {
  const segments = DIAGRAM_SKILL_INSTALL_TARGETS[harness].segments;
  const primary = path.join(cwd, ...segments);
  if (harness !== "cursor") return [primary];
  // Cursor loads from both `.cursor/skills/` and `.agents/skills/`.
  return [primary, path.join(cwd, ".agents", "skills", "diagram")];
}

/**
 * Best-effort install of the bundled diagram skill into the project cwd when
 * an agent session starts. Agents only discover skills from on-disk folders;
 * without this, users must run "Install diagram skill" manually per project.
 */
export function ensureDiagramSkillForAgent(
  appPath: string,
  cwd: string,
  agent: TaskAgent | undefined,
): void {
  if (!agent) return;
  const harness = AGENT_HARNESS[agent];
  if (!harness) return;

  const sourceDir = findBundledSkillSource(bundledDiagramSkillSourceDirs(appPath));
  if (!sourceDir) return;

  installSkillWhereMissing(sourceDir, diagramSkillTargetPaths(cwd, harness));
}
