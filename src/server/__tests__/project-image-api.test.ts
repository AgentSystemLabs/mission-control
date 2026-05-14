import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-project-image-api-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { ensureApiTokenBootstrap } = await import("../bootstrap");
const { MAX_PROJECT_IMAGE_DATA_URL_LENGTH } = await import("../services/project-images");
const { getDb } = await import("~/db/client");
const { groups, projects, tasks } = await import("~/db/schema");

const pngDataUrl = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;

function authedHeaders(extra?: Record<string, string>): Record<string, string> {
  return { authorization: `Bearer ${ensureApiTokenBootstrap()}`, ...(extra ?? {}) };
}

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("project image API", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(groups).run();
  });

  it("persists a valid project image data URL on create", async () => {
    const projectDir = fs.mkdtempSync(path.join(tmpRoot, "project-"));
    const response = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          name: "image api",
          path: projectDir,
          imageDataUrl: pngDataUrl,
        }),
      }),
    );

    expect(response?.status).toBe(201);
    expect(await jsonBody(response!)).toMatchObject({
      project: { imageDataUrl: pngDataUrl },
    });
  });

  it("returns an application error for duplicate projects without leaking database details", async () => {
    const projectDir = fs.mkdtempSync(path.join(tmpRoot, "project-duplicate-"));
    const first = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "first", path: projectDir }),
      }),
    );
    expect(first?.status).toBe(201);

    const duplicate = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "second", path: projectDir }),
      }),
    );
    const body = await jsonBody(duplicate!);

    expect(duplicate?.status).toBe(409);
    expect(body).toMatchObject({
      error: "A project for this working directory already exists.",
      code: "duplicate_project",
    });
    expect(String(body.error)).not.toContain("Failed query");
    expect(String(body.error)).not.toContain("insert into");
  });

  it("returns an application validation error for invalid local project paths", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          name: "missing path",
          path: path.join(tmpRoot, "does-not-exist"),
        }),
      }),
    );

    expect(response?.status).toBe(400);
    expect(await jsonBody(response!)).toMatchObject({
      error: "Working directory does not exist",
    });
  });

  it("returns application errors for duplicate groups and terminals", async () => {
    const firstGroup = await handleApiRequest(
      new Request("http://localhost/api/groups", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "duplicate" }),
      }),
    );
    expect(firstGroup?.status).toBe(201);

    const duplicateGroup = await handleApiRequest(
      new Request("http://localhost/api/groups", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "duplicate" }),
      }),
    );
    expect(duplicateGroup?.status).toBe(409);
    expect(await jsonBody(duplicateGroup!)).toMatchObject({
      error: 'A group named "duplicate" already exists.',
      code: "duplicate_group",
    });

    const projectDir = fs.mkdtempSync(path.join(tmpRoot, "project-terminal-"));
    const created = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "terminal project", path: projectDir }),
      }),
    );
    const project = (await jsonBody(created!)).project as { id: string };
    const terminalBody = JSON.stringify({ name: "Shell" });

    const firstTerminal = await handleApiRequest(
      new Request(`http://localhost/api/projects/${project.id}/user-terminals`, {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: terminalBody,
      }),
    );
    expect(firstTerminal?.status).toBe(201);

    const duplicateTerminal = await handleApiRequest(
      new Request(`http://localhost/api/projects/${project.id}/user-terminals`, {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: terminalBody,
      }),
    );
    expect(duplicateTerminal?.status).toBe(409);
    expect(await jsonBody(duplicateTerminal!)).toMatchObject({
      error: 'A terminal named "Shell" already exists for this project.',
      code: "duplicate_user_terminal",
    });
  });

  it("does not return git stderr in API error responses", async () => {
    const projectDir = fs.mkdtempSync(path.join(tmpRoot, "project-not-git-"));
    const created = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "not git", path: projectDir }),
      }),
    );
    const project = (await jsonBody(created!)).project as { id: string };

    const response = await handleApiRequest(
      new Request(`http://localhost/api/projects/${project.id}/git/status`, {
        method: "GET",
        headers: authedHeaders(),
      }),
    );
    const body = await jsonBody(response!);

    expect(response?.status).toBe(400);
    expect(body).toMatchObject({
      error: "git status failed",
      code: "git_operation_failed",
    });
    expect(body).not.toHaveProperty("stderr");
    expect(JSON.stringify(body)).not.toContain("not a git repository");
  });

  it("rejects invalid project image data URLs", async () => {
    const projectDir = fs.mkdtempSync(path.join(tmpRoot, "project-invalid-"));
    const response = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          name: "bad image api",
          path: projectDir,
          imageDataUrl: "data:text/plain;base64,aGVsbG8=",
        }),
      }),
    );

    expect(response?.status).toBe(400);
    expect(await jsonBody(response!)).toMatchObject({
      error: expect.stringContaining("Project image"),
    });
  });

  it("rejects oversized project image request bodies", async () => {
    const projectDir = fs.mkdtempSync(path.join(tmpRoot, "project-oversized-"));
    const response = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          name: "oversized image api",
          path: projectDir,
          imageDataUrl: `data:image/png;base64,${"A".repeat(MAX_PROJECT_IMAGE_DATA_URL_LENGTH + 25_000)}`,
        }),
      }),
    );

    expect(response?.status).toBe(413);
    expect(await jsonBody(response!)).toMatchObject({
      error: "request body too large",
    });
  });

  it("keeps local image paths and image data URLs mutually exclusive", async () => {
    const projectDir = fs.mkdtempSync(path.join(tmpRoot, "project-switch-"));
    const created = await handleApiRequest(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "switch image api", path: projectDir }),
      }),
    );
    const project = (await jsonBody(created!)).project as { id: string };

    const dataUpdate = await handleApiRequest(
      new Request(`http://localhost/api/projects/${project.id}`, {
        method: "PATCH",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ imageDataUrl: pngDataUrl }),
      }),
    );
    expect(await jsonBody(dataUpdate!)).toMatchObject({
      project: { imageDataUrl: pngDataUrl, imagePath: null },
    });

    const pathUpdate = await handleApiRequest(
      new Request(`http://localhost/api/projects/${project.id}`, {
        method: "PATCH",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ imagePath: "local.png" }),
      }),
    );
    expect(await jsonBody(pathUpdate!)).toMatchObject({
      project: { imageDataUrl: null, imagePath: "local.png" },
    });
  });
});
