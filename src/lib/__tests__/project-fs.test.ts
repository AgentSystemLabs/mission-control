import { describe, it, expect, afterEach, vi } from "vitest";
import {
  sandboxContainerRoot,
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
} from "../project-fs";

function stubElectron(
  runtimeMode: "host" | "docker",
  impl: Record<string, unknown>,
  enabled = true,
) {
  (globalThis as { window?: unknown }).window = {
    electronAPI: {
      sandbox: {
        getState: vi
          .fn()
          .mockResolvedValue({ status: enabled && runtimeMode === "docker" ? "connected" : "disabled" }),
      },
      ...impl,
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("sandboxContainerRoot", () => {
  it("derives /workspace/<slug> from the host dir basename", () => {
    expect(sandboxContainerRoot("/Users/me/code/Acme App")).toBe("/workspace/acme-app");
    expect(sandboxContainerRoot("/")).toBe("/workspace/project");
    expect(sandboxContainerRoot("/srv/my_repo/")).toBe("/workspace/my-repo");
  });
});

describe("listProjectFiles routing", () => {
  it("uses host files.list when runtime is host", async () => {
    const files = { list: vi.fn().mockResolvedValue({ ok: true, files: ["a"] }) };
    const remoteFs = { list: vi.fn() };
    stubElectron("host", { files, remoteFs });
    const r = await listProjectFiles("/Users/me/acme");
    expect(files.list).toHaveBeenCalledWith("/Users/me/acme");
    expect(remoteFs.list).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, files: ["a"] });
  });

  it("uses remoteFs.list with the container path when runtime is docker", async () => {
    const files = { list: vi.fn() };
    const remoteFs = { list: vi.fn().mockResolvedValue({ ok: true, files: ["b"] }) };
    stubElectron("docker", { files, remoteFs });
    await listProjectFiles("/Users/me/acme");
    expect(remoteFs.list).toHaveBeenCalledWith("/workspace/acme");
    expect(files.list).not.toHaveBeenCalled();
  });

  it("uses host files.list when docker runtime is configured but sandbox is disabled", async () => {
    const files = { list: vi.fn().mockResolvedValue({ ok: true, files: ["a"] }) };
    const remoteFs = { list: vi.fn() };
    stubElectron("docker", { files, remoteFs }, false);
    await listProjectFiles("/Users/me/acme");
    expect(files.list).toHaveBeenCalledWith("/Users/me/acme");
    expect(remoteFs.list).not.toHaveBeenCalled();
  });
});

describe("readProjectFile / writeProjectFile routing", () => {
  it("reads from the joined container path under docker", async () => {
    const files = { read: vi.fn() };
    const remoteFs = {
      read: vi.fn().mockResolvedValue({ ok: true, kind: "text", content: "", mtimeMs: 0, lineCount: 0 }),
    };
    stubElectron("docker", { files, remoteFs });
    await readProjectFile("/Users/me/acme", "src/x.ts");
    expect(remoteFs.read).toHaveBeenCalledWith("/workspace/acme/src/x.ts");
  });

  it("writes via host files.write under host runtime", async () => {
    const files = { write: vi.fn().mockResolvedValue({ ok: true, mtimeMs: 1 }) };
    const remoteFs = { write: vi.fn() };
    stubElectron("host", { files, remoteFs });
    await writeProjectFile("/Users/me/acme", "src/x.ts", "hi", 5);
    expect(files.write).toHaveBeenCalledWith("/Users/me/acme", "src/x.ts", "hi", 5);
    expect(remoteFs.write).not.toHaveBeenCalled();
  });

  it("returns a not-electron error when the bridge is absent", async () => {
    delete (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {};
    const r = await listProjectFiles("/x");
    expect(r.ok).toBe(false);
  });
});
