import * as fs from "node:fs";
import * as path from "node:path";
import { assertSafeProjectRelativePath, copySkillTree } from "./_skills-install-helpers";
import { resolveRegisteredProjectPath } from "./path-security";
import {
  diagramSkillInstalledPaths,
  resolveDiagramSkillSourceDir,
} from "../bundled-skills-path";
import {
  DIAGRAM_SKILL_HARNESS_KEYS,
  DIAGRAM_SKILL_INSTALL_TARGETS,
  type DiagramSkillHarnessSelection,
  type DiagramSkillInstallResult,
} from "~/shared/diagram-skill-install";

export type InstallDiagramSkillArgs = {
  projectPath: string;
  harnesses: DiagramSkillHarnessSelection;
};

export type InstallDiagramSkillResult = DiagramSkillInstallResult;

function emptyInstallResult(): InstallDiagramSkillResult {
  return { claudeInstalled: false, codexInstalled: false, cursorInstalled: false };
}

export function readDiagramSkillInstallStatus(projectPath: string): InstallDiagramSkillResult {
  if (!projectPath?.trim()) {
    return emptyInstallResult();
  }
  try {
    const resolved = resolveRegisteredProjectPath(projectPath);
    const installed = diagramSkillInstalledPaths(resolved);
    return {
      claudeInstalled: installed.claude,
      codexInstalled: installed.codex,
      cursorInstalled: installed.cursor,
    };
  } catch {
    return emptyInstallResult();
  }
}

export async function installDiagramSkill(
  args: InstallDiagramSkillArgs,
): Promise<InstallDiagramSkillResult> {
  const { harnesses } = args;
  if (!args.projectPath?.trim()) throw new Error("projectPath is required");
  if (!DIAGRAM_SKILL_HARNESS_KEYS.some((key) => harnesses[key])) {
    throw new Error("Select at least one CLI tool");
  }

  const projectPath = resolveRegisteredProjectPath(args.projectPath);
  const sourceDir = resolveDiagramSkillSourceDir();
  const result = emptyInstallResult();

  for (const harness of DIAGRAM_SKILL_HARNESS_KEYS) {
    if (!harnesses[harness]) continue;
    const segments = DIAGRAM_SKILL_INSTALL_TARGETS[harness].segments;
    const rel = path.posix.join(...segments);
    assertSafeProjectRelativePath(projectPath, rel, "diagram skill install");
    const targetDirs = [path.join(projectPath, ...segments)];
    if (harness === "cursor") {
      targetDirs.push(path.join(projectPath, ".agents", "skills", "diagram"));
    }
    for (const targetDir of targetDirs) {
      await fs.promises.rm(targetDir, { recursive: true, force: true });
      await copySkillTree(sourceDir, targetDir);
    }
    result[`${harness}Installed`] = true;
  }

  return result;
}
