import * as fs from "node:fs";
import * as path from "node:path";

const CORE_PLUGIN_NAME = "agentsystem-core";

function corePluginRootCandidates(): string[] {
  const candidates: string[] = [];
  const explicitRoot = process.env.MC_CORE_PLUGIN_ROOT?.trim();
  if (explicitRoot) {
    candidates.push(path.resolve(explicitRoot));
  }
  const serverEntry = process.env.SERVER_ENTRY?.trim();
  if (serverEntry) {
    candidates.push(
      path.resolve(path.dirname(serverEntry), "..", "bundled-skills", CORE_PLUGIN_NAME),
    );
  }
  candidates.push(path.resolve(process.cwd(), "dist", "bundled-skills", CORE_PLUGIN_NAME));
  candidates.push(
    path.resolve(process.cwd(), "dist-server", "bundled-skills", CORE_PLUGIN_NAME),
  );
  candidates.push(
    path.resolve(process.cwd(), "..", "core", "plugins", CORE_PLUGIN_NAME),
  );
  return candidates;
}

export function resolveCorePluginRoot(): string {
  for (const candidate of corePluginRootCandidates()) {
    const skillsDir = path.join(candidate, "skills", "ship");
    if (fs.existsSync(path.join(skillsDir, "SKILL.md"))) return candidate;
  }
  throw new Error(
    `AgentSystem core plugin is not available in this build (expected ${CORE_PLUGIN_NAME})`,
  );
}

export type CorePluginSkill = {
  name: string;
  dir: string;
};

export type CorePluginAgent = {
  name: string;
  file: string;
};

export function discoverCorePluginSkills(pluginRoot: string): CorePluginSkill[] {
  const skillsDir = path.join(pluginRoot, "skills");
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir)
    .filter((entry) => {
      const dir = path.join(skillsDir, entry);
      return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, "SKILL.md"));
    })
    .sort()
    .map((name) => ({ name, dir: path.join(skillsDir, name) }));
}

export function discoverCorePluginAgents(pluginRoot: string): CorePluginAgent[] {
  const agentsDir = path.join(pluginRoot, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  return fs
    .readdirSync(agentsDir)
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((entry) => ({
      name: entry.slice(0, -3),
      file: path.join(agentsDir, entry),
    }));
}
