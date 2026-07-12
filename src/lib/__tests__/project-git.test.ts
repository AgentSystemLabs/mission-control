import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("~/lib/api", () => ({
  api: {
    getGitStatus: vi.fn().mockResolvedValue({ branch: "host" }),
    getGitDiff: vi.fn().mockResolvedValue({ kind: "empty" }),
  },
}));

import { api } from "~/lib/api";
import { fetchGitStatus, fetchGitDiff } from "../project-git";

function stub(
  runtimeMode: "host" | "docker",
  remoteGit: Record<string, unknown>,
  enabled = true,
) {
  (globalThis as { window?: unknown }).window = {
    electronAPI: {
      sandbox: {
        getState: vi
          .fn()
          .mockResolvedValue({ status: enabled && runtimeMode === "docker" ? "connected" : "disabled" }),
      },
      remoteGit,
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.clearAllMocks();
});

describe("fetchGitStatus routing", () => {
  it("uses the HTTP API when no sandboxRepoPath is given", async () => {
    stub("docker", { status: vi.fn() });
    const r = await fetchGitStatus("p1", null);
    expect(api.getGitStatus).toHaveBeenCalledWith("p1", null);
    expect(r).toEqual({ branch: "host" });
  });

  it("uses the HTTP API under host runtime even with a sandboxRepoPath", async () => {
    const remoteGit = { status: vi.fn() };
    stub("host", remoteGit);
    await fetchGitStatus("p1", null, "/workspace/acme");
    expect(api.getGitStatus).toHaveBeenCalled();
    expect(remoteGit.status).not.toHaveBeenCalled();
  });

  it("uses remoteGit under docker runtime + sandboxRepoPath, backfilling behindCount", async () => {
    // The sandbox agent's git RPC doesn't compute behindCount; the router
    // normalizes the missing field to null so the GitStatus type matches runtime.
    const remoteGit = { status: vi.fn().mockResolvedValue({ branch: "sbx" }) };
    stub("docker", remoteGit);
    const r = await fetchGitStatus("p1", null, "/workspace/acme");
    expect(remoteGit.status).toHaveBeenCalledWith("/workspace/acme");
    expect(r).toEqual({ branch: "sbx", behindCount: null });
    expect(api.getGitStatus).not.toHaveBeenCalled();
  });

  it("uses the HTTP API when docker runtime is configured but sandbox is disabled", async () => {
    const remoteGit = { status: vi.fn() };
    stub("docker", remoteGit, false);
    await fetchGitStatus("p1", null, "/workspace/acme");
    expect(api.getGitStatus).toHaveBeenCalledWith("p1", null);
    expect(remoteGit.status).not.toHaveBeenCalled();
  });
});

describe("fetchGitDiff routing", () => {
  it("uses remoteGit.diff under docker + sandboxRepoPath", async () => {
    const remoteGit = { diff: vi.fn().mockResolvedValue({ kind: "text", patch: "x", truncated: false }) };
    stub("docker", remoteGit);
    await fetchGitDiff("p1", "a.ts", false, null, "/workspace/acme");
    expect(remoteGit.diff).toHaveBeenCalledWith("/workspace/acme", "a.ts", false);
    expect(api.getGitDiff).not.toHaveBeenCalled();
  });

  it("falls back to the HTTP API without a sandboxRepoPath", async () => {
    stub("docker", { diff: vi.fn() });
    await fetchGitDiff("p1", "a.ts", false, null);
    expect(api.getGitDiff).toHaveBeenCalledWith("p1", "a.ts", false, null);
  });
});
