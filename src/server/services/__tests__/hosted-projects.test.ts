import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { HostedAuthContext } from "../../hosted-auth-context";

const poolQuery = vi.hoisted(() => vi.fn());
const deleteRemoteSandboxByIdOrName = vi.hoisted(() => vi.fn());
const deleteRemoteSandboxesForProject = vi.hoisted(() => vi.fn());
const deleteRemoteSandboxesForTask = vi.hoisted(() => vi.fn());
const ensureRemoteProjectRepository = vi.hoisted(() => vi.fn());
const killRemotePtysForProject = vi.hoisted(() => vi.fn());
const killRemotePtysForTask = vi.hoisted(() => vi.fn());

vi.mock("../../hosted-pg", () => ({
  getHostedPool: () => ({ query: poolQuery }),
  getHostedDatabaseUrl: () => "postgres://test",
  isHostedDatabaseEnabled: () => true,
}));

vi.mock("../daytona-remote-pty", () => ({
  deleteRemoteSandboxByIdOrName,
  deleteRemoteSandboxesForProject,
  deleteRemoteSandboxesForTask,
  ensureRemoteProjectRepository,
  killRemotePtysForProject,
  killRemotePtysForTask,
}));

const {
  createHostedProject,
  createHostedTask,
  deleteHostedProject,
  deleteHostedTask,
  listHostedProjects,
} = await import("../hosted-projects");
const {
  createHostedGroup,
  listHostedGroups,
  updateHostedGroup,
} = await import("../hosted-groups");
const {
  createHostedUserTerminal,
  listHostedUserTerminals,
} = await import("../hosted-user-terminals");
const {
  issueHostedHookToken,
  validateHostedHookToken,
} = await import("../hosted-hook-tokens");
const { processHostedCleanupOutbox } = await import("../hosted-cleanup-outbox");
const {
  enforceHostedComputeLimit,
  hostedComputeLimitStatus,
} = await import("../hosted-plan-limits");

const context: HostedAuthContext = {
  sessionId: "hs-1",
  academyUserId: "academy-user-1",
  userId: "user-1",
  email: "user@example.com",
  organizationId: null,
};

function hostedProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "hp-1",
    name: "Remote Repo",
    remotePath: "/home/workspace/remote-repo",
    githubUrl: "https://github.com/example/remote-repo",
    branch: "main",
    icon: "RR",
    iconColor: "#ff5a1f",
    imagePath: null,
    groupId: "hg-1",
    pinned: false,
    launchCommands: [{ id: "dev", name: "Dev", command: "pnpm dev" }],
    launchUrl: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function hostedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "ht-1",
    projectId: "hp-1",
    title: "Build it",
    icon: null,
    agent: "claude-code",
    status: "running",
    branch: "main",
    preview: "working",
    lines: 12,
    archived: false,
    claudeSessionId: "session-1",
    claudeSkipPermissions: false,
    claudeBareSession: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("hosted project persistence", () => {
  beforeEach(() => {
    poolQuery.mockReset();
    deleteRemoteSandboxByIdOrName.mockReset();
    deleteRemoteSandboxesForProject.mockReset();
    deleteRemoteSandboxesForTask.mockReset();
    ensureRemoteProjectRepository.mockReset();
    killRemotePtysForProject.mockReset();
    killRemotePtysForTask.mockReset();
    ensureRemoteProjectRepository.mockResolvedValue({ sandboxId: "sandbox-user-1", branch: "main" });
    delete process.env.MC_PLAN_LIMITS_JSON;
    delete process.env.MC_MAX_COMPUTE_SECONDS_PER_USER;
    delete process.env.MC_COMPUTE_LIMIT_WINDOW_DAYS;
  });

  it("maps hosted projects into the existing project response shape", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [hostedProject()] })
      .mockResolvedValueOnce({
        rows: [
          hostedTask(),
          hostedTask({ id: "ht-2", status: "finished", preview: "done" }),
        ],
      });

    const projects = await listHostedProjects(context);

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "hp-1",
      groupId: "hg-1",
      path: "/home/workspace/remote-repo",
      githubUrl: "https://github.com/example/remote-repo",
      preview: "working",
      launchCommands: JSON.stringify([{ id: "dev", name: "Dev", command: "pnpm dev" }]),
      taskCounts: expect.objectContaining({
        total: 2,
        running: 1,
        finished: 1,
        activeNonDone: 1,
      }),
    });
  });

  it("maps legacy Daytona home paths to the current workspace path", async () => {
    poolQuery
      .mockResolvedValueOnce({
        rows: [hostedProject({ remotePath: "/home/daytona/remote-repo" })],
      })
      .mockResolvedValueOnce({ rows: [] });

    const projects = await listHostedProjects(context);

    expect(projects[0]?.path).toBe("/home/workspace/remote-repo");
  });

  it("creates hosted projects as Daytona-backed rows scoped to the signed-in user", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ id: "hg-1" }] })
      .mockResolvedValueOnce({ rows: [{ sourceTier: "operators" }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({
        rows: [hostedProject({ id: "hp-created", name: "New Repo", remotePath: "/home/workspace/new-repo" })],
      });

    const project = await createHostedProject(context, {
      name: "New Repo",
      path: "/home/workspace/new-repo",
      groupId: "hg-1",
    });

    expect(project).toMatchObject({
      id: "hp-created",
      name: "New Repo",
      path: "/home/workspace/new-repo",
      groupId: "hg-1",
    });
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(`'daytona', 'daytona'`),
      expect.arrayContaining([null, "user-1", "New Repo", "/home/workspace/new-repo", "hg-1"]),
    );
  });

  it("clones GitHub repositories into a derived Daytona workspace path", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ sourceTier: "operators" }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({
        rows: [
          hostedProject({
            id: "hp-created",
            name: "Repo",
            remoteSandboxId: "sandbox-user-1",
            remotePath: "/home/workspace/repo",
            githubUrl: "https://github.com/example/repo",
          }),
        ],
      });

    const project = await createHostedProject(context, {
      githubUrl: "https://github.com/example/repo.git",
    });

    expect(project).toMatchObject({
      id: "hp-created",
      name: "Repo",
      path: "/home/workspace/repo",
    });
    expect(ensureRemoteProjectRepository).toHaveBeenCalledWith({
      context,
      projectId: expect.any(String),
      path: "/home/workspace/repo",
      githubUrl: "https://github.com/example/repo",
    });
    expect(poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining(`"githubUrl"`),
      expect.arrayContaining([
        "repo",
        "sandbox-user-1",
        "/home/workspace/repo",
        "https://github.com/example/repo",
        "main",
      ]),
    );
  });

  it("preserves the shared user sandbox when deleting a hosted project", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ remoteSandboxId: "sandbox-user-1" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    deleteRemoteSandboxesForProject.mockResolvedValue(undefined);

    await expect(deleteHostedProject(context, "hp-1")).resolves.toBe(true);

    expect(killRemotePtysForProject).toHaveBeenCalledWith(context, "hp-1");
    expect(deleteRemoteSandboxByIdOrName).not.toHaveBeenCalled();
    expect(deleteRemoteSandboxesForProject).toHaveBeenCalledWith(context, "hp-1");
    expect(poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining(`DELETE FROM "hostedProject"`),
      [null, "user-1", "hp-1"],
    );
  });

  it("kills active task PTYs before deleting a hosted task", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [hostedTask({ id: "ht-1", projectId: "hp-1" })] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    deleteRemoteSandboxesForTask.mockResolvedValue(undefined);

    await expect(deleteHostedTask(context, "ht-1")).resolves.toBe(true);

    expect(killRemotePtysForTask).toHaveBeenCalledWith(context, "ht-1");
    expect(deleteRemoteSandboxesForTask).toHaveBeenCalledWith(context, "hp-1", "ht-1");
  });

  it("persists hosted groups in the signed-in scope", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "hg-1",
            name: "Work",
            color: "#ff5a1f",
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      });

    const group = await createHostedGroup(context, { name: "Work" });

    expect(group).toMatchObject({ id: "hg-1", name: "Work", color: "#ff5a1f" });
    expect(poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining(`INSERT INTO "hostedGroup"`),
      expect.arrayContaining([null, "user-1", "Work"]),
    );
  });

  it("lists and updates hosted groups through scoped queries", async () => {
    poolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "hg-1",
            name: "Work",
            color: "#ff5a1f",
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "hg-1",
            name: "Clients",
            color: "#00ff99",
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      });

    await expect(listHostedGroups(context)).resolves.toHaveLength(1);
    await expect(updateHostedGroup(context, "hg-1", { name: "Clients" })).resolves.toMatchObject({
      id: "hg-1",
      name: "Clients",
    });
    expect(poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining(`UPDATE "hostedGroup"`),
      [null, "user-1", "hg-1", "Clients", null],
    );
  });

  it("persists hosted user terminals scoped to hosted projects", async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [hostedProject()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ sourceTier: "operators" }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "hut-1",
            projectId: "hp-1",
            name: "Terminal 1",
            cwd: "/home/workspace/remote-repo",
            startCommand: null,
            position: 0,
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      });

    const terminal = await createHostedUserTerminal(context, {
      projectId: "hp-1",
      cwd: "/home/workspace/remote-repo",
    });

    expect(terminal).toMatchObject({
      id: "hut-1",
      projectId: "hp-1",
      name: "Terminal 1",
      cwd: "/home/workspace/remote-repo",
    });
    expect(poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining(`INSERT INTO "hostedUserTerminal"`),
      expect.arrayContaining(["hp-1", "Terminal 1", "/home/workspace/remote-repo", null, 0]),
    );
  });

  it("enforces configured hosted project plan limits", async () => {
    process.env.MC_PLAN_LIMITS_JSON = JSON.stringify({
      operators: { projects: 1, tasks: 10, userTerminals: 10 },
    });
    poolQuery
      .mockResolvedValueOnce({ rows: [{ sourceTier: "operators" }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    await expect(
      createHostedProject(context, {
        name: "Limit Hit",
        path: "/home/workspace/limit-hit",
      }),
    ).rejects.toThrow("projects plan limit reached");
    expect(poolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining(`INSERT INTO "hostedProject"`),
      expect.anything(),
    );
    delete process.env.MC_PLAN_LIMITS_JSON;
  });

  it("enforces configured hosted task plan limits", async () => {
    process.env.MC_PLAN_LIMITS_JSON = JSON.stringify({
      operators: { projects: 10, tasks: 1, userTerminals: 10 },
    });
    poolQuery
      .mockResolvedValueOnce({ rows: [hostedProject()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ sourceTier: "operators" }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    await expect(
      createHostedTask(context, {
        projectId: "hp-1",
        title: "Limit hit",
        agent: "claude-code",
      }),
    ).rejects.toThrow("tasks plan limit reached");
    expect(poolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining(`INSERT INTO "hostedTask"`),
      expect.anything(),
    );
    delete process.env.MC_PLAN_LIMITS_JSON;
  });

  it("enforces configured hosted user terminal plan limits", async () => {
    process.env.MC_PLAN_LIMITS_JSON = JSON.stringify({
      operators: { projects: 10, tasks: 10, userTerminals: 1 },
    });
    poolQuery
      .mockResolvedValueOnce({ rows: [hostedProject()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ sourceTier: "operators" }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    await expect(
      createHostedUserTerminal(context, {
        projectId: "hp-1",
        cwd: "/home/workspace/remote-repo",
      }),
    ).rejects.toThrow("userTerminals plan limit reached");
    expect(poolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining(`INSERT INTO "hostedUserTerminal"`),
      expect.anything(),
    );
    delete process.env.MC_PLAN_LIMITS_JSON;
  });

  it("enforces configured hosted compute plan limits", async () => {
    process.env.MC_PLAN_LIMITS_JSON = JSON.stringify({
      operators: { projects: 10, tasks: 10, userTerminals: 10, computeSeconds: 100 },
    });
    process.env.MC_COMPUTE_LIMIT_WINDOW_DAYS = "30";
    poolQuery
      .mockResolvedValueOnce({ rows: [{ sourceTier: "operators" }] })
      .mockResolvedValueOnce({ rows: [{ currentPeriodStartsAt: null }] })
      .mockResolvedValueOnce({ rows: [{ total: 100 }] });

    await expect(enforceHostedComputeLimit(context)).rejects.toThrow(
      "compute limit reached",
    );

    expect(poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining(`FROM "hostedRuntimeUsage"`),
      [null, "user-1", null, 30],
    );
    delete process.env.MC_PLAN_LIMITS_JSON;
    delete process.env.MC_COMPUTE_LIMIT_WINDOW_DAYS;
  });

  it("reports hosted compute usage below the configured plan limit", async () => {
    process.env.MC_MAX_COMPUTE_SECONDS_PER_USER = "100";
    poolQuery
      .mockResolvedValueOnce({ rows: [{ sourceTier: null }] })
      .mockResolvedValueOnce({ rows: [{ currentPeriodStartsAt: null }] })
      .mockResolvedValueOnce({ rows: [{ total: 25 }] });

    await expect(hostedComputeLimitStatus(context)).resolves.toMatchObject({
      allowed: true,
      limitSeconds: 100,
      usedSeconds: 25,
      windowDays: 30,
    });
    delete process.env.MC_MAX_COMPUTE_SECONDS_PER_USER;
  });

  it("resets hosted compute usage at the Academy billing period start", async () => {
    process.env.MC_MAX_COMPUTE_SECONDS_PER_USER = "100";
    const periodStart = new Date("2026-05-01T00:00:00.000Z");
    poolQuery
      .mockResolvedValueOnce({ rows: [{ sourceTier: "mission_control_cloud" }] })
      .mockResolvedValueOnce({ rows: [{ currentPeriodStartsAt: periodStart }] })
      .mockResolvedValueOnce({ rows: [{ total: 10 }] });

    await expect(hostedComputeLimitStatus(context)).resolves.toMatchObject({
      allowed: true,
      limitSeconds: 100,
      usedSeconds: 10,
      currentPeriodStartsAt: "2026-05-01T00:00:00.000Z",
    });
    expect(poolQuery).toHaveBeenLastCalledWith(
      expect.stringContaining(`COALESCE($3::timestamp`),
      [null, "user-1", periodStart, 30],
    );
    delete process.env.MC_MAX_COMPUTE_SECONDS_PER_USER;
  });

  it("lists only visible hosted user terminals for the signed-in scope", async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "hut-1",
          projectId: "hp-1",
          name: "Terminal 1",
          cwd: "/home/workspace/remote-repo",
          startCommand: null,
          position: 0,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const terminals = await listHostedUserTerminals(context, "hp-1");

    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      id: "hut-1",
      projectId: "hp-1",
      startCommand: null,
    });
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(`"hostedUserTerminal"."startCommand" IS NULL`),
      [null, "user-1", "hp-1"],
    );
  });

  it("issues and validates hosted hook tokens for remote agent callbacks", async () => {
    poolQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            taskId: "ht-1",
            tokenHash: createHash("sha256").update("hook-token", "utf8").digest("hex"),
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      });

    const issued = await issueHostedHookToken(context, "ht-1");
    expect(issued).toMatch(/^[0-9a-f]{64}$/);
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(`INSERT INTO "hookToken"`),
      expect.arrayContaining([null, "user-1", "ht-1"]),
    );

    await expect(validateHostedHookToken("ht-1", "hook-token")).resolves.toBe(true);
  });

  it("retries cleanup outbox rows after a legacy Daytona project cleanup failure", async () => {
    const row = {
      id: "hco-1",
      scope: { organizationId: null, userId: "user-1" },
      payload: { projectId: "hp-1", remoteSandboxId: "sandbox-1" },
    };
    poolQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });
    deleteRemoteSandboxesForProject
      .mockRejectedValueOnce(new Error("daytona unavailable"))
      .mockResolvedValueOnce(undefined);

    await processHostedCleanupOutbox();
    expect(poolQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(`SET "status" = 'failed'`),
      ["hco-1", "daytona unavailable"],
    );

    await processHostedCleanupOutbox();
    expect(deleteRemoteSandboxByIdOrName).not.toHaveBeenCalled();
    expect(deleteRemoteSandboxesForProject).toHaveBeenCalledTimes(2);
    expect(deleteRemoteSandboxesForProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "hp-1",
    );
    expect(poolQuery).toHaveBeenNthCalledWith(
      7,
      expect.stringContaining(`SET "status" = 'done'`),
      ["hco-1"],
    );
  });
});
