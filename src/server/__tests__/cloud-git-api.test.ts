import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cloud-git-api-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

vi.mock("../services/git", async () => {
  const actual = await vi.importActual<typeof import("../services/git")>("../services/git");
  return {
    ...actual,
    getGitStatus: vi.fn(async () => ({
      branch: "main",
      staged: [],
      unstaged: [],
      changedCount: 0,
      aheadCount: null,
    })),
  };
});

const { handleApiRequest } = await import("../api-router");
const { ensureApiTokenBootstrap } = await import("../bootstrap");
const { createProject } = await import("../services/projects");
const { getDb } = await import("~/db/client");
const { groups, projects, tasks } = await import("~/db/schema");

function authedHeaders(extra?: Record<string, string>): Record<string, string> {
  return { authorization: `Bearer ${ensureApiTokenBootstrap()}`, ...(extra ?? {}) };
}

describe("cloud git API", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(groups).run();
  });

  it("routes Daytona projects through the git service instead of returning 501", async () => {
    const project = await createProject({
      runtimeKind: "daytona",
      repoUrl: "https://github.com/AgentSystemLabs/mission-control.git",
    });

    const response = await handleApiRequest(
      new Request(`http://localhost/api/projects/${project.id}/git/status`, {
        method: "GET",
        headers: authedHeaders(),
      }),
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      branch: "main",
      staged: [],
      unstaged: [],
      changedCount: 0,
      aheadCount: null,
    });
  });
});
