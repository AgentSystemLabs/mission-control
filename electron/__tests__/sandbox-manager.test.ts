import { describe, expect, it, vi } from "vitest";
import {
  cloneCoordinationKey,
  EXPECTED_SANDBOX_AGENT_VERSION,
  gitAuthCloneFailureHint,
  isAgentCredsSetupUnsupportedError,
  isSafeSshCloneRemote,
  isSandboxAgentVersionCurrent,
  makeCloneCoordinator,
} from "../sandbox-manager";

/** A promise plus its resolve/reject, so a test can hold a clone "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("sandbox-manager clone compatibility helpers", () => {
  it("accepts safe SSH clone remotes", () => {
    expect(isSafeSshCloneRemote("git@github.com:webdevcody/webdevcody.com.git")).toBe(true);
    expect(isSafeSshCloneRemote("ssh://git@example.com/owner/repo.git")).toBe(true);
  });

  it("rejects option-shaped or credential-bearing SSH remotes", () => {
    expect(isSafeSshCloneRemote("-Fconfig@example.com:owner/repo.git")).toBe(false);
    expect(isSafeSshCloneRemote("git@example.com:-oProxyCommand=evil/repo.git")).toBe(false);
    expect(isSafeSshCloneRemote("ssh://git:secret@example.com/owner/repo.git")).toBe(false);
  });

  it("detects stale sandbox agent versions", () => {
    expect(isSandboxAgentVersionCurrent(EXPECTED_SANDBOX_AGENT_VERSION)).toBe(true);
    expect(isSandboxAgentVersionCurrent("0.2.0")).toBe(false);
  });

  it("adds mode-specific guidance for SSH publickey clone failures", () => {
    const err = new Error("git clone failed: git@github.com: Permission denied (publickey).");

    expect(gitAuthCloneFailureHint("none", err)).toContain("no Git authentication");
    expect(gitAuthCloneFailureHint("copy-host", err)).toContain("copy file keys");
    expect(gitAuthCloneFailureHint("generate", err)).toContain("Add the generated public key");
    expect(gitAuthCloneFailureHint("generate", new Error("network failed"))).toBeNull();
  });

  it("detects old agents that silently drop the credential setup RPC", () => {
    expect(isAgentCredsSetupUnsupportedError(new Error("agent rpc creds.setup timed out"))).toBe(true);
    expect(isAgentCredsSetupUnsupportedError(new Error("Sandbox agent did not write Claude Code credentials."))).toBe(
      false,
    );
  });
});

describe("clone coordination key", () => {
  it("is stable for the same (sandbox, slug)", () => {
    expect(cloneCoordinationKey("sb-1", "app")).toBe(cloneCoordinationKey("sb-1", "app"));
  });

  it("distinguishes sandboxes, slugs, and the Local (null) scope", () => {
    expect(cloneCoordinationKey("sb-1", "app")).not.toBe(cloneCoordinationKey("sb-2", "app"));
    expect(cloneCoordinationKey("sb-1", "app")).not.toBe(cloneCoordinationKey("sb-1", "api"));
    // null (Local) maps to "" and must not collide with a real id, nor let a
    // slug bleed across the separator (e.g. id "a" + slug "b" vs id "" + slug "ab").
    expect(cloneCoordinationKey(null, "app")).not.toBe(cloneCoordinationKey("app", ""));
    expect(cloneCoordinationKey("a", "b")).not.toBe(cloneCoordinationKey("", "ab"));
  });
});

describe("clone single-flight coordinator", () => {
  it("collapses concurrent clones of the same key onto one run", async () => {
    const coord = makeCloneCoordinator();
    const d = deferred<string>();
    const work = vi.fn(() => d.promise);
    const key = cloneCoordinationKey("sb-1", "app");

    const a = coord.run(key, work);
    const b = coord.run(key, work);

    // The second caller joined the first's in-flight clone — no second git.clone.
    expect(work).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(coord.inFlightCount).toBe(1);

    d.resolve("cloned");
    await expect(a).resolves.toBe("cloned");
    await expect(b).resolves.toBe("cloned");
    expect(coord.inFlightCount).toBe(0);
  });

  it("runs different keys independently", async () => {
    const coord = makeCloneCoordinator();
    const work = vi.fn(() => Promise.resolve("ok"));

    await Promise.all([
      coord.run(cloneCoordinationKey("sb-1", "app"), work),
      coord.run(cloneCoordinationKey("sb-2", "app"), work),
    ]);

    expect(work).toHaveBeenCalledTimes(2);
    expect(coord.inFlightCount).toBe(0);
  });

  it("allows a fresh clone once the prior settles (no permanent block)", async () => {
    const coord = makeCloneCoordinator();
    const work = vi.fn(() => Promise.resolve("ok"));
    const key = cloneCoordinationKey("sb-1", "app");

    await coord.run(key, work);
    await coord.run(key, work);

    expect(work).toHaveBeenCalledTimes(2);
    expect(coord.inFlightCount).toBe(0);
  });

  it("propagates rejection to every joined caller and frees the slot", async () => {
    const coord = makeCloneCoordinator();
    const d = deferred<string>();
    const work = vi.fn(() => d.promise);
    const key = cloneCoordinationKey("sb-1", "app");

    const a = coord.run(key, work);
    const b = coord.run(key, work);
    d.reject(new Error("destination path already exists and is not an empty directory"));

    await expect(a).rejects.toThrow("already exists");
    await expect(b).rejects.toThrow("already exists");
    expect(work).toHaveBeenCalledTimes(1);
    expect(coord.inFlightCount).toBe(0);
  });
});
