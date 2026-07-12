import { describe, expect, it } from "vitest";
import { normalizeRepoRemote, hashRepoKey } from "../repo-key";

describe("normalizeRepoRemote", () => {
  it("normalizes the common github remote forms to one key", () => {
    const expected = "github.com/owner/repo";
    expect(normalizeRepoRemote("git@github.com:owner/repo.git")).toBe(expected);
    expect(normalizeRepoRemote("git@github.com:owner/repo")).toBe(expected);
    expect(normalizeRepoRemote("ssh://git@github.com/owner/repo.git")).toBe(expected);
    expect(normalizeRepoRemote("https://github.com/owner/repo.git")).toBe(expected);
    expect(normalizeRepoRemote("https://github.com/owner/repo")).toBe(expected);
    expect(normalizeRepoRemote("http://github.com/owner/repo/")).toBe(expected);
    expect(normalizeRepoRemote("github.com/owner/repo")).toBe(expected);
  });

  it("is case-insensitive so collaborators always match", () => {
    expect(normalizeRepoRemote("git@GitHub.com:Owner/Repo.git")).toBe(
      normalizeRepoRemote("https://github.com/owner/repo"),
    );
  });

  it("strips credentials and ports", () => {
    expect(normalizeRepoRemote("https://user:pass@gitlab.com:8443/group/repo.git")).toBe(
      "gitlab.com/group/repo",
    );
  });

  it("supports non-github hosts and nested subgroups", () => {
    expect(normalizeRepoRemote("git@gitlab.com:group/subgroup/repo.git")).toBe(
      "gitlab.com/group/subgroup/repo",
    );
    expect(normalizeRepoRemote("https://git.self-hosted.example/team/repo.git")).toBe(
      "git.self-hosted.example/team/repo",
    );
  });

  it("keeps distinct repos distinct", () => {
    expect(normalizeRepoRemote("git@github.com:owner/repo-a.git")).not.toBe(
      normalizeRepoRemote("git@github.com:owner/repo-b.git"),
    );
    expect(normalizeRepoRemote("git@github.com:owner-a/repo.git")).not.toBe(
      normalizeRepoRemote("git@gitlab.com:owner-a/repo.git"),
    );
  });

  it("returns null for local-only / unparseable remotes", () => {
    expect(normalizeRepoRemote(null)).toBeNull();
    expect(normalizeRepoRemote(undefined)).toBeNull();
    expect(normalizeRepoRemote("")).toBeNull();
    expect(normalizeRepoRemote("   ")).toBeNull();
    expect(normalizeRepoRemote("/Users/me/code/repo")).toBeNull();
    expect(normalizeRepoRemote("../bare-repo.git")).toBeNull();
    expect(normalizeRepoRemote("file:///Users/me/repo.git")).toBeNull();
    expect(normalizeRepoRemote("C:\\Users\\me\\repo")).toBeNull();
    expect(normalizeRepoRemote("just-a-word")).toBeNull();
  });
});

describe("hashRepoKey", () => {
  it("is deterministic, hex, and 64 chars (SHA-256)", async () => {
    const a = await hashRepoKey("github.com/owner/repo");
    const b = await hashRepoKey("github.com/owner/repo");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different repos", async () => {
    const a = await hashRepoKey("github.com/owner/repo-a");
    const b = await hashRepoKey("github.com/owner/repo-b");
    expect(a).not.toBe(b);
  });
});
