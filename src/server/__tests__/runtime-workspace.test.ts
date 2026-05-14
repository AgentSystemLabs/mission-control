import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-runtime-workspace-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject, getProjectRow, updateProject } = await import("../services/projects");
const { __setDaytonaClientForTests, ensureProjectSandbox, getRuntimeWorkspacePath, writeRuntimePty } =
  await import("../runtime/daytona");
const { getDb } = await import("~/db/client");
const { groups, projects, tasks } = await import("~/db/schema");

describe("Daytona workspace paths", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(groups).run();
    __setDaytonaClientForTests(null);
  });

  afterEach(() => {
    __setDaytonaClientForTests(null);
  });

  it("maps legacy /workspace paths to the sandbox workdir-relative workspace", async () => {
    const project = await createProject({
      runtimeKind: "daytona",
      repoUrl: "https://github.com/AgentSystemLabs/mission-control.git",
    });
    await updateProject(project.id, {
      workspacePath: "/workspace/agentsystemlabs-mission-control",
    });

    await expect(getRuntimeWorkspacePath(project.id)).resolves.toBe(
      "workspace/agentsystemlabs-mission-control",
    );
  });

  it("accepts paginated Daytona sandbox list responses when finding an existing sandbox", async () => {
    const project = await createProject({
      runtimeKind: "daytona",
      repoUrl: "https://github.com/AgentSystemLabs/mission-control.git",
    });
    await updateProject(project.id, {
      sandboxId: "sandbox-1",
      workspacePath: "/workspace/agentsystemlabs-mission-control",
    });
    const gitStatus = vi.fn(async () => ({ currentBranch: "main" }));
    const sandbox = {
      id: "sandbox-1",
      process: { createPty: vi.fn() },
      fs: {
        listFiles: vi.fn(),
        downloadFile: vi.fn(),
        uploadFile: vi.fn(),
      },
      git: {
        clone: vi.fn(),
        status: gitStatus,
      },
    };
    __setDaytonaClientForTests({
      create: vi.fn(async () => {
        throw new Error("unexpected sandbox create");
      }),
      list: vi.fn(async () => ({ items: [sandbox] })),
    });

    await expect(ensureProjectSandbox(project.id)).resolves.toBe(sandbox);
    expect(gitStatus).toHaveBeenCalledWith("workspace/agentsystemlabs-mission-control");
    expect(sandbox.git.clone).not.toHaveBeenCalled();
    await expect(getProjectRow(project.id)).resolves.toMatchObject({
      workspacePath: "workspace/agentsystemlabs-mission-control",
    });
  });

  it("starts a stopped Daytona sandbox before git operations", async () => {
    const project = await createProject({
      runtimeKind: "daytona",
      repoUrl: "https://github.com/AgentSystemLabs/mission-control.git",
    });
    await updateProject(project.id, {
      sandboxId: "sandbox-1",
      sandboxState: "stopped",
      workspacePath: "workspace/agentsystemlabs-mission-control",
    });
    const start = vi.fn(async function (this: { state?: string }) {
      this.state = "started";
    });
    const gitStatus = vi.fn(async () => ({ currentBranch: "main" }));
    const sandbox = {
      id: "sandbox-1",
      state: "stopped",
      start,
      process: { createPty: vi.fn() },
      fs: {
        listFiles: vi.fn(),
        downloadFile: vi.fn(),
        uploadFile: vi.fn(),
      },
      git: {
        clone: vi.fn(),
        status: gitStatus,
      },
    };
    __setDaytonaClientForTests({
      create: vi.fn(async () => {
        throw new Error("unexpected sandbox create");
      }),
      get: vi.fn(async () => sandbox),
    });

    await expect(ensureProjectSandbox(project.id)).resolves.toBe(sandbox);

    expect(start).toHaveBeenCalledWith(60);
    expect(gitStatus).toHaveBeenCalledWith("workspace/agentsystemlabs-mission-control");
    expect(sandbox.git.clone).not.toHaveBeenCalled();
    await expect(getProjectRow(project.id)).resolves.toMatchObject({
      sandboxState: "started",
    });
  });

  it("reconnects a Daytona PTY by project id before writing input", async () => {
    const project = await createProject({
      runtimeKind: "daytona",
      repoUrl: "https://github.com/AgentSystemLabs/mission-control.git",
    });
    await updateProject(project.id, {
      sandboxId: "sandbox-1",
      workspacePath: "workspace/agentsystemlabs-mission-control",
    });
    const sendInput = vi.fn(async () => undefined);
    const connectPty = vi.fn(async () => ({ sendInput }));
    const sandbox = {
      id: "sandbox-1",
      process: { createPty: vi.fn(), connectPty },
      fs: {
        listFiles: vi.fn(),
        downloadFile: vi.fn(),
        uploadFile: vi.fn(),
      },
      git: {
        clone: vi.fn(),
        status: vi.fn(async () => ({ currentBranch: "main" })),
      },
    };
    __setDaytonaClientForTests({
      create: vi.fn(async () => {
        throw new Error("unexpected sandbox create");
      }),
      get: vi.fn(async () => sandbox),
    });

    const ok = await writeRuntimePty("cloud-pty-existing", "hello", project.id);

    expect(ok).toBe(true);
    expect(connectPty).toHaveBeenCalledWith(
      "cloud-pty-existing",
      expect.objectContaining({ onData: expect.any(Function) }),
    );
    expect(sendInput).toHaveBeenCalledWith("hello");
  });
});
