import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskAgent } from "../src/shared/domain";

// Per-harness skill folder segments (mirrors DIAGRAM_SKILL_INSTALL_TARGETS).
// The Recall skill is just instructions, so it installs into whichever CLI's
// skills folder the session uses.
const HARNESS_SEGMENTS: Partial<Record<TaskAgent, string[]>> = {
  "claude-code": [".claude", "skills", "recall"],
  codex: [".codex", "skills", "recall"],
  "cursor-cli": [".cursor", "skills", "recall"],
};

function bundledRecallSkillSourceDirs(appPath: string): string[] {
  // In dev, `app.getAppPath()` resolves to `<repo>/dist-electron/electron`, so
  // appPath-anchored lookups miss the repo-root source; `process.cwd()` is the
  // repo root (the electron main is launched from there). Packaged builds keep
  // the appPath (asar) + dist paths. See the same fix in ensure-recall-mcp.ts.
  return [
    path.join(process.cwd(), ".agents", "skills", "recall"),
    path.join(process.cwd(), "dist", "bundled-skills", "recall"),
    path.join(appPath, ".agents", "skills", "recall"),
    path.join(appPath, "dist", "bundled-skills", "recall"),
    path.join(appPath, "dist-server", "bundled-skills", "recall"),
    path.join(appPath, "..", "..", ".agents", "skills", "recall"),
    path.join(appPath, "..", "..", "dist", "bundled-skills", "recall"),
  ];
}

function resolveBundledRecallSkillSource(appPath: string): string | null {
  for (const candidate of bundledRecallSkillSourceDirs(appPath)) {
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

function recallSkillTargetPaths(cwd: string, agent: TaskAgent): string[] {
  const segments = HARNESS_SEGMENTS[agent];
  if (!segments) return [];
  const primary = path.join(cwd, ...segments);
  if (agent !== "cursor-cli") return [primary];
  // Cursor loads from both `.cursor/skills/` and `.agents/skills/`.
  return [primary, path.join(cwd, ".agents", "skills", "recall")];
}

/**
 * Best-effort install of the bundled Recall skill into the project cwd when an
 * agent session starts, so the agent knows it can persist project knowledge to
 * Recall. Agents only discover skills from on-disk folders. Fully fail-soft —
 * installing a skill must never block or delay PTY spawn.
 */
export function ensureRecallSkillForAgent(
  appPath: string,
  cwd: string,
  agent: TaskAgent | undefined,
): void {
  if (!agent) return;
  const targets = recallSkillTargetPaths(cwd, agent);
  if (!targets.length) return;

  const sourceDir = resolveBundledRecallSkillSource(appPath);
  if (!sourceDir) return;

  for (const targetDir of targets) {
    if (fs.existsSync(path.join(targetDir, "SKILL.md"))) continue;
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      copySkillTree(sourceDir, targetDir);
    } catch {
      /* swallow — skill install must never block PTY spawn */
    }
  }
}
