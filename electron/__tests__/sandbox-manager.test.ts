import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_SANDBOX_AGENT_VERSION,
  gitAuthCloneFailureHint,
  isLegacyHttpOnlyCloneError,
  isSafeSshCloneRemote,
  isSandboxAgentVersionCurrent,
  resolveDefaultImageBuildIn,
} from "../sandbox-manager";

describe("sandbox-manager clone compatibility helpers", () => {
  it("detects legacy agents that reject SSH remotes as non-HTTP URLs", () => {
    expect(isLegacyHttpOnlyCloneError(new Error("invalid remote: must be an http(s) URL"))).toBe(true);
    expect(isLegacyHttpOnlyCloneError(new Error("git clone failed"))).toBe(false);
  });

  it("accepts safe SSH clone remotes for stale-agent fallback", () => {
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

describe("resolveDefaultImageBuildIn", () => {
  const dockerfile = (root: string) => path.join(root, "docker", "sandbox-base", "Dockerfile");
  const bundle = (root: string) => path.join(root, "mc-agent", "dist", "mc-agent.cjs");
  const packageRoot = (root: string) => path.join(root, "node_modules", "@agentsystemlabs", "mission-control-agent");
  const packageDockerfile = (root: string) => path.join(packageRoot(root), "docker", "sandbox-base", "Dockerfile");
  const packageBundle = (root: string) => path.join(packageRoot(root), "dist", "cli.cjs");

  it("prefers the installed public agent package when present", () => {
    const root = "/repo";
    const present = new Set([packageDockerfile(root), packageBundle(root), dockerfile(root), bundle(root)]);
    const got = resolveDefaultImageBuildIn([root], (p) => present.has(p));
    expect(got).toEqual({
      dockerfile: packageDockerfile(root),
      context: packageRoot(root),
    });
  });

  it("falls back to the legacy Dockerfile + mc-agent context from the first complete root", () => {
    const root = "/repo";
    const present = new Set([dockerfile(root), bundle(root)]);
    const got = resolveDefaultImageBuildIn([root], (p) => present.has(p));
    expect(got).toEqual({
      dockerfile: dockerfile(root),
      context: path.join(root, "mc-agent"),
    });
  });

  it("skips a root missing the built bundle (half-staged tree)", () => {
    const root = "/repo";
    const present = new Set([dockerfile(root)]); // Dockerfile but no dist bundle
    expect(resolveDefaultImageBuildIn([root], (p) => present.has(p))).toBeNull();
  });

  it("falls through to a later root when the first is incomplete", () => {
    const dev = "/dev";
    const resources = "/resources";
    // dev has only the Dockerfile; the packaged resources dir has both.
    const present = new Set([dockerfile(dev), dockerfile(resources), bundle(resources)]);
    const got = resolveDefaultImageBuildIn(["", dev, resources], (p) => present.has(p));
    expect(got?.context).toBe(path.join(resources, "mc-agent"));
  });

  it("returns null when no root is complete", () => {
    expect(resolveDefaultImageBuildIn(["/a", "/b"], () => false)).toBeNull();
  });
});
