import { describe, expect, it } from "vitest";
import {
  EXPECTED_SANDBOX_AGENT_VERSION,
  gitAuthCloneFailureHint,
  isSafeSshCloneRemote,
  isSandboxAgentVersionCurrent,
} from "../sandbox-manager";

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
});
