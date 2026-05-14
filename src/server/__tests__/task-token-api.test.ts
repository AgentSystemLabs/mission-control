import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-token-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { createProject } = await import("../services/projects");
const { createTask, getTask } = await import("../services/tasks");
const { issueTaskToken } = await import("../services/task-token");

describe("task-scoped API auth", () => {
  it("accepts a per-task token for status updates", async () => {
    const projectDir = fs.mkdtempSync(path.join(tmpRoot, "project-"));
    const project = await createProject({ path: projectDir });
    const task = await createTask({
      projectId: project.id,
      title: "Task token status update",
      agent: "claude-code",
    });
    const token = issueTaskToken(task.id);

    const response = await handleApiRequest(
      new Request(`http://localhost/api/tasks/${task.id}/status`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "running" }),
      }),
    );

    expect(response?.status).toBe(200);
    expect((await getTask(task.id))?.status).toBe("running");
  });
});
