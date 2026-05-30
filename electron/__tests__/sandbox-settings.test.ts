import { describe, it, expect } from "vitest";
import {
  parsePublishedPorts,
  readSandboxSettings,
  writeSandboxSettings,
  ensurePairingToken,
  rotatePairingToken,
  sanitizeBuildArgs,
  isValidVolumeName,
  DEFAULT_AGENT_PORT,
  DEFAULT_WORKSPACE_VOLUME,
  DEFAULT_AGENT_CONFIG_VOLUME,
  type SettingsKV,
} from "../sandbox-settings";

function memKV(): SettingsKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: (k) => store.get(k) ?? null,
    set: (k, v) => {
      store.set(k, v);
    },
  };
}

describe("parsePublishedPorts", () => {
  it("parses CSV", () => {
    expect(parsePublishedPorts("3000,5173,8000")).toEqual([3000, 5173, 8000]);
  });
  it("parses ranges", () => {
    expect(parsePublishedPorts("3000-3003")).toEqual([3000, 3001, 3002, 3003]);
  });
  it("parses a JSON array", () => {
    expect(parsePublishedPorts("[5173, 3000]")).toEqual([3000, 5173]);
  });
  it("dedupes and sorts mixed input", () => {
    expect(parsePublishedPorts("8000, 3000-3001, 3000")).toEqual([3000, 3001, 8000]);
  });
  it("drops invalid ports and tokens", () => {
    expect(parsePublishedPorts("0, 70000, abc, 3000, -5")).toEqual([3000]);
    expect(parsePublishedPorts("")).toEqual([]);
    expect(parsePublishedPorts(null)).toEqual([]);
  });
});

describe("readSandboxSettings defaults", () => {
  it("returns sane defaults for an empty store", () => {
    const s = readSandboxSettings(memKV());
    expect(s).toEqual({
      enabled: false,
      runtimeMode: "host",
      dockerfilePath: null,
      buildArgs: {},
      imageTag: null,
      publishedPorts: [],
      workspaceVolume: DEFAULT_WORKSPACE_VOLUME,
      projectPaths: {},
      agentPort: DEFAULT_AGENT_PORT,
      pairingToken: null,
      agentConfigVolume: DEFAULT_AGENT_CONFIG_VOLUME,
      gitAuthMode: "none",
    });
  });
});

describe("writeSandboxSettings", () => {
  it("round-trips a patch and only touches provided keys", () => {
    const kv = memKV();
    writeSandboxSettings(kv, { enabled: true, runtimeMode: "docker", agentPort: 9444 });
    let s = readSandboxSettings(kv);
    expect(s.enabled).toBe(true);
    expect(s.runtimeMode).toBe("docker");
    expect(s.agentPort).toBe(9444);
    // unspecified keys keep defaults
    expect(s.workspaceVolume).toBe(DEFAULT_WORKSPACE_VOLUME);

    writeSandboxSettings(kv, { dockerfilePath: "/repo/Dockerfile" });
    s = readSandboxSettings(kv);
    expect(s.dockerfilePath).toBe("/repo/Dockerfile");
    expect(s.enabled).toBe(true); // untouched
  });

  it("normalizes a published-ports string into a sorted array", () => {
    const kv = memKV();
    writeSandboxSettings(kv, { publishedPorts: "5173, 3000-3001" });
    expect(readSandboxSettings(kv).publishedPorts).toEqual([3000, 3001, 5173]);
  });

  it("ignores an invalid agentPort", () => {
    const kv = memKV();
    writeSandboxSettings(kv, { agentPort: 999999 });
    expect(readSandboxSettings(kv).agentPort).toBe(DEFAULT_AGENT_PORT);
  });

  it("stores projectPaths and buildArgs as JSON records", () => {
    const kv = memKV();
    writeSandboxSettings(kv, {
      projectPaths: { p1: "/workspace/acme" },
      buildArgs: { NODE_VERSION: "22" },
    });
    const s = readSandboxSettings(kv);
    expect(s.projectPaths).toEqual({ p1: "/workspace/acme" });
    expect(s.buildArgs).toEqual({ NODE_VERSION: "22" });
  });
});

describe("input validation (compose-injection hardening)", () => {
  it("sanitizeBuildArgs drops keys that aren't valid Docker ARG names", () => {
    expect(
      sanitizeBuildArgs({
        NODE_VERSION: "22",
        // newline-bearing key would inject sibling compose service keys
        "X\n      privileged: true\n      y": "z",
        "bad-key": "v",
        "1leading": "v",
      }),
    ).toEqual({ NODE_VERSION: "22" });
  });

  it("isValidVolumeName rejects bind-mount / traversal payloads", () => {
    expect(isValidVolumeName("mc-workspace")).toBe(true);
    expect(isValidVolumeName("../../etc:/host_etc # ")).toBe(false);
    expect(isValidVolumeName("/var/run/docker.sock")).toBe(false);
    expect(isValidVolumeName("a b")).toBe(false);
  });

  it("writeSandboxSettings rejects a malicious volume name (keeps default)", () => {
    const kv = memKV();
    writeSandboxSettings(kv, { workspaceVolume: "../../etc:/host # " });
    expect(readSandboxSettings(kv).workspaceVolume).toBe(DEFAULT_WORKSPACE_VOLUME);
  });

  it("writeSandboxSettings strips injected build-arg keys", () => {
    const kv = memKV();
    writeSandboxSettings(kv, { buildArgs: { OK: "1", "bad: key": "2" } });
    expect(readSandboxSettings(kv).buildArgs).toEqual({ OK: "1" });
  });
});

describe("pairing token", () => {
  it("generates once and is stable across reads", () => {
    const kv = memKV();
    const a = ensurePairingToken(kv);
    const b = ensurePairingToken(kv);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(readSandboxSettings(kv).pairingToken).toBe(a);
  });

  it("rotate produces a new token", () => {
    const kv = memKV();
    const a = ensurePairingToken(kv);
    const b = rotatePairingToken(kv);
    expect(b).not.toBe(a);
    expect(b).toMatch(/^[0-9a-f]{48}$/);
    expect(readSandboxSettings(kv).pairingToken).toBe(b);
  });
});
