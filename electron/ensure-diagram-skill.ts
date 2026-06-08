import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskAgent } from "../src/shared/domain";
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

function resolveBundledDiagramSkillSource(appPath: string): string | null {
  for (const candidate of bundledDiagramSkillSourceDirs(appPath)) {
    if (fs.existsSync(path.join(candidate, "SKILL.md"))) return candidate;
  }
  return null;
}

function copySkillTree(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copySkillTree(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.copyFileSync(from, to);
  }
}

function diagramSkillTargetPaths(cwd: string, harness: DiagramSkillHarness): string[] {
  const segments = DIAGRAM_SKILL_INSTALL_TARGETS[harness].segments;
  const primary = path.join(cwd, ...segments);
  if (harness !== "cursor") return [primary];
  // Cursor loads from both `.cursor/skills/` and `.agents/skills/`.
  return [primary, path.join(cwd, ".agents", "skills", "diagram")];
}

function isDiagramSkillInstalled(targetDir: string): boolean {
  return fs.existsSync(path.join(targetDir, "SKILL.md"));
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

  const sourceDir = resolveBundledDiagramSkillSource(appPath);
  if (!sourceDir) return;

  for (const targetDir of diagramSkillTargetPaths(cwd, harness)) {
    if (isDiagramSkillInstalled(targetDir)) continue;
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      copySkillTree(sourceDir, targetDir);
    } catch {
      /* swallow — skill install must never block PTY spawn */
    }
  }
}
