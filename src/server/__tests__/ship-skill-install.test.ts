import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SHIP_SKILL_INSTALL_TARGETS,
  SHIP_SKILL_MARKER,
} from "~/shared/ship-skill-install";
import { resolveCorePluginRoot } from "../core-plugin-path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ship-skill-test-"));
const corePluginRoot = path.join(tmpRoot, "agentsystem-core");
process.env.MC_USER_DATA_DIR = tmpRoot;
process.env.MC_CORE_PLUGIN_ROOT = corePluginRoot;

function writeCorePluginFixture(): void {
  fs.mkdirSync(path.join(corePluginRoot, "skills", "ship"), { recursive: true });
  fs.mkdirSync(path.join(corePluginRoot, "skills", "reviewer"), { recursive: true });
  fs.mkdirSync(path.join(corePluginRoot, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(corePluginRoot, "skills", "ship", "SKILL.md"),
    ["---", "name: ship", "description: Ship work", "---", "", "# Ship", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(corePluginRoot, "skills", "reviewer", "SKILL.md"),
    ["---", "name: reviewer", "description: Review work", "---", "", "# Reviewer", ""].join(
      "\n",
    ),
  );
  fs.writeFileSync(
    path.join(corePluginRoot, "agents", "utility-finder.md"),
    [
      "---",
      "name: utility-finder",
      "description: Finds existing utilities",
      "---",
      "",
      "Use existing helpers before adding new ones.",
      "",
    ].join("\n"),
  );
}

writeCorePluginFixture();

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");

const LOOPBACK_HEADERS = { origin: "http://127.0.0.1:5173" };

function authed(input: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:5173${input}`, {
    ...init,
    headers: {
      ...LOOPBACK_HEADERS,
      authorization: `Bearer ${getOrCreateApiToken()}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

describe("ship skills install API", () => {
  let projectPath = "";

  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();

    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ship-skill-proj-"));
    createProject({ name: "ship-skill", path: projectPath });
  });

  it("installs AgentSystem core skills and subagents into selected harness folders", async () => {
    const pluginRoot = resolveCorePluginRoot();
    const expectedSkillCount = fs
      .readdirSync(path.join(pluginRoot, "skills"))
      .filter((entry) =>
        fs.existsSync(path.join(pluginRoot, "skills", entry, "SKILL.md")),
      ).length;
    const expectedAgentCount = fs
      .readdirSync(path.join(pluginRoot, "agents"))
      .filter((entry) => entry.endsWith(".md")).length;

    const res = await handleApiRequest(
      authed("/api/skills/install/ship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectPath,
          harnesses: { claude: true, codex: true, cursor: true },
        }),
      }),
    );

    expect(res?.status).toBe(200);
    const body = (await res?.json()) as {
      result: {
        claudeInstalled: boolean;
        codexInstalled: boolean;
        cursorInstalled: boolean;
        skillsInstalled: number;
        agentsInstalled: number;
      };
    };
    expect(body.result.claudeInstalled).toBe(true);
    expect(body.result.codexInstalled).toBe(true);
    expect(body.result.cursorInstalled).toBe(true);
    expect(body.result.skillsInstalled).toBe(expectedSkillCount * 3);
    expect(body.result.agentsInstalled).toBe(expectedAgentCount * 3);

    for (const harness of ["claude", "codex", "cursor"] as const) {
      const segments = SHIP_SKILL_INSTALL_TARGETS[harness].skillSegments;
      const skillFile = path.join(projectPath, ...segments, SHIP_SKILL_MARKER, "SKILL.md");
      expect(fs.existsSync(skillFile)).toBe(true);
    }

    expect(
      fs.existsSync(path.join(projectPath, ".agents", "skills", SHIP_SKILL_MARKER, "SKILL.md")),
    ).toBe(true);

    const claudeShip = path.join(
      projectPath,
      ".claude",
      "skills",
      SHIP_SKILL_MARKER,
      "SKILL.md",
    );
    expect(fs.readFileSync(claudeShip, "utf8")).toContain("name: ship");

    const codexShip = path.join(
      projectPath,
      ".codex",
      "skills",
      SHIP_SKILL_MARKER,
      "SKILL.md",
    );
    expect(fs.readFileSync(codexShip, "utf8")).toContain('name: "ship"');

    const codexAgent = path.join(projectPath, ".codex", "agents", "utility-finder.toml");
    expect(fs.existsSync(codexAgent)).toBe(true);
    expect(fs.readFileSync(codexAgent, "utf8")).toContain('name = "utility-finder"');
  });

  it("reports install status for a project", async () => {
    await handleApiRequest(
      authed("/api/skills/install/ship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectPath,
          harnesses: { claude: true, codex: false, cursor: false },
        }),
      }),
    );

    const res = await handleApiRequest(
      authed(
        `/api/skills/install/ship/installed?projectPath=${encodeURIComponent(projectPath)}`,
      ),
    );
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({
      installed: {
        claudeInstalled: true,
        codexInstalled: false,
        cursorInstalled: false,
        skillsInstalled: 0,
        agentsInstalled: 0,
      },
    });
  });
});
