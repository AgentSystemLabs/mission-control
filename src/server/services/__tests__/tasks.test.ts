import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tasks-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { createTask, listTasksForProjectWorktree } = await import("../tasks");
const { getDb } = await import("~/db/client");
const { projects, tasks, userTerminals, worktrees, sandboxes } = await import("~/db/schema");

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-project-"));
  return createProject({ name: "p", path: dir });
}

function makeSandbox(id: string, projectId: string) {
  const now = Date.now();
  getDb()
    .insert(sandboxes)
    .values({
      id,
      name: "Sandbox",
      kind: "remote-vm",
      color: null,
      imageTag: null,
      dockerfilePath: null,
      buildArgs: null,
      gitAuthMode: "none",
      copyAgentCreds: false,
      declaredPorts: null,
      env: null,
      hostAgentPort: null,
      portMap: null,
      pairingToken: null,
      remoteConfig: JSON.stringify({ agentUrl: "wss://agent.example.com/", projectId }),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("tasks service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(userTerminals).run();
    db.delete(worktrees).run();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(sandboxes).run();
  });

  it("scopes tasks per sandbox runtime", () => {
    const p = makeProject();
    makeSandbox("sb-1", p.id);
    createTask({ projectId: p.id, title: "Local", agent: "claude-code", scopeId: "local" });
    createTask({ projectId: p.id, title: "Sandbox", agent: "claude-code", scopeId: "sb-1" });

    expect(listTasksForProjectWorktree(p.id, null, "local").map((task) => task.title)).toEqual([
      "Local",
    ]);
    expect(listTasksForProjectWorktree(p.id, null, "sb-1").map((task) => task.title)).toEqual([
      "Sandbox",
    ]);
  });

  it("rejects tasks for an unknown sandbox scope", () => {
    const p = makeProject();
    expect(() =>
      createTask({ projectId: p.id, title: "Missing", agent: "claude-code", scopeId: "sb-missing" }),
    ).toThrow("Sandbox scope does not exist");
  });
});
