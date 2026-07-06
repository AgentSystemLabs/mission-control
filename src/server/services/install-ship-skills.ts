import * as fs from "node:fs";
import * as path from "node:path";
import {
  discoverCorePluginAgents,
  discoverCorePluginSkills,
  resolveCorePluginRoot,
} from "../core-plugin-path";
import { assertSafeProjectRelativePath, copySkillTree } from "./_skills-install-helpers";
import { resolveRegisteredProjectPath } from "./path-security";
import {
  convertAgentToCodexToml,
  normalizeCodexSkill,
} from "./core-skill-format";
import {
  SHIP_SKILL_HARNESS_KEYS,
  SHIP_SKILL_INSTALL_TARGETS,
  SHIP_SKILL_MARKER,
  type ShipSkillHarness,
  type ShipSkillHarnessSelection,
  type ShipSkillInstallResult,
} from "~/shared/ship-skill-install";

export type InstallShipSkillsArgs = {
  projectPath: string;
  harnesses: ShipSkillHarnessSelection;
};

export type InstallShipSkillsResult = ShipSkillInstallResult;

function emptyInstallResult(): ShipSkillInstallResult {
  return {
    claudeInstalled: false,
    codexInstalled: false,
    cursorInstalled: false,
    skillsInstalled: 0,
    agentsInstalled: 0,
  };
}

function skillTargetDirs(
  projectPath: string,
  harness: ShipSkillHarness,
  skillName: string,
): string[] {
  const target = SHIP_SKILL_INSTALL_TARGETS[harness];
  const dirs = [path.join(projectPath, ...target.skillSegments, skillName)];
  if (harness === "cursor") {
    dirs.push(path.join(projectPath, ".agents", "skills", skillName));
  }
  return dirs;
}

function isShipSkillInstalled(projectPath: string, harness: ShipSkillHarness): boolean {
  const segments = SHIP_SKILL_INSTALL_TARGETS[harness].skillSegments;
  return fs.existsSync(path.join(projectPath, ...segments, SHIP_SKILL_MARKER, "SKILL.md"));
}

export function readShipSkillInstallStatus(projectPath: string): ShipSkillInstallResult {
  if (!projectPath?.trim()) {
    return emptyInstallResult();
  }
  try {
    const resolved = resolveRegisteredProjectPath(projectPath);
    return {
      claudeInstalled: isShipSkillInstalled(resolved, "claude"),
      codexInstalled: isShipSkillInstalled(resolved, "codex"),
      cursorInstalled: isShipSkillInstalled(resolved, "cursor"),
      skillsInstalled: 0,
      agentsInstalled: 0,
    };
  } catch {
    return emptyInstallResult();
  }
}

export async function installShipSkills(
  args: InstallShipSkillsArgs,
): Promise<ShipSkillInstallResult> {
  const { harnesses } = args;
  if (!args.projectPath?.trim()) throw new Error("projectPath is required");
  if (!SHIP_SKILL_HARNESS_KEYS.some((key) => harnesses[key])) {
    throw new Error("Select at least one CLI tool");
  }

  const projectPath = resolveRegisteredProjectPath(args.projectPath);
  const pluginRoot = resolveCorePluginRoot();
  const skills = discoverCorePluginSkills(pluginRoot);
  const agents = discoverCorePluginAgents(pluginRoot);
  if (skills.length === 0) {
    throw new Error("No AgentSystem core skills found to install");
  }

  const result = emptyInstallResult();
  const selectedHarnessCount = SHIP_SKILL_HARNESS_KEYS.filter((key) => harnesses[key]).length;

  for (const harness of SHIP_SKILL_HARNESS_KEYS) {
    if (!harnesses[harness]) continue;

    const target = SHIP_SKILL_INSTALL_TARGETS[harness];
    const agentsDir = path.join(projectPath, ...target.agentSegments);
    const agentsRel = path.posix.join(...target.agentSegments);
    assertSafeProjectRelativePath(projectPath, agentsRel, "ship skills install");

    for (const { name, dir } of skills) {
      const rel = path.posix.join(...target.skillSegments, name);
      assertSafeProjectRelativePath(projectPath, rel, "ship skills install");
      for (const targetDir of skillTargetDirs(projectPath, harness, name)) {
        await fs.promises.rm(targetDir, { recursive: true, force: true });
        await copySkillTree(dir, targetDir);
        if (harness === "codex") {
          normalizeCodexSkill(path.join(targetDir, "SKILL.md"), name);
        }
      }
    }

    await fs.promises.mkdir(agentsDir, { recursive: true });
    for (const { name, file } of agents) {
      const agentFileName = `${name}${target.agentExtension}`;
      const rel = path.posix.join(...target.agentSegments, agentFileName);
      assertSafeProjectRelativePath(projectPath, rel, "ship skills install");
      const targetFile = path.join(agentsDir, agentFileName);
      await fs.promises.rm(targetFile, { force: true });
      if (harness === "codex") {
        convertAgentToCodexToml(file, targetFile, name);
      } else {
        await fs.promises.copyFile(file, targetFile);
      }
    }

    result[`${harness}Installed`] = true;
  }

  result.skillsInstalled = skills.length * selectedHarnessCount;
  result.agentsInstalled = agents.length * selectedHarnessCount;
  return result;
}
