import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DIAGRAM_SKILL_INSTALL_TARGETS } from "~/shared/diagram-skill-install";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-diagram-skill-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

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

describe("diagram skill install API", () => {
  let projectPath = "";

  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();

    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "mc-diagram-skill-proj-"));
    createProject({ name: "diagram-skill", path: projectPath });
  });

  it("installs the bundled diagram skill into selected harness folders", async () => {
    const res = await handleApiRequest(
      authed("/api/skills/install/diagram", {
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
      };
    };
    expect(body.result).toEqual({
      claudeInstalled: true,
      codexInstalled: true,
      cursorInstalled: true,
    });

    for (const harness of ["claude", "codex", "cursor"] as const) {
      const segments = DIAGRAM_SKILL_INSTALL_TARGETS[harness].segments;
      const skillFile = path.join(projectPath, ...segments, "SKILL.md");
      expect(fs.existsSync(skillFile)).toBe(true);
    }

    const claudeSkill = path.join(projectPath, ".claude", "skills", "diagram", "SKILL.md");
    expect(fs.readFileSync(claudeSkill, "utf8")).toContain("POST $MC_API_URL/api/diagram");
    expect(fs.readFileSync(claudeSkill, "utf8")).toContain("MC_THEME");
  });

  it("reports install status for a project", async () => {
    await handleApiRequest(
      authed("/api/skills/install/diagram", {
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
        `/api/skills/install/diagram/installed?projectPath=${encodeURIComponent(projectPath)}`,
      ),
    );
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({
      installed: { claudeInstalled: true, codexInstalled: false, cursorInstalled: false },
    });
  });
});
