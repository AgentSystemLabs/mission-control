import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setApiToken } from "../api";

describe("api worktree deletion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setApiToken(null);
  });

  it("sends stash delete mode in the URL and body", async () => {
    setApiToken("token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await api.deleteWorktree("project-1", "worktree-1", { stashChanges: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(
      "/api/projects/project-1/worktrees/worktree-1?stashChanges=true",
    );
    expect(init?.body).toBe(JSON.stringify({ stashChanges: true }));
  });
});
