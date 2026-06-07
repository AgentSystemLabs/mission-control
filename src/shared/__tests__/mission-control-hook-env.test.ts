import { describe, it, expect } from "vitest";
import {
  buildMissionControlApiUrl,
  buildLocalMissionControlApiUrl,
  buildSandboxMissionControlApiUrl,
  buildAgentLocalHookApiUrl,
  buildSandboxHookRelayUrl,
  buildSyntheticHookUrl,
  hookEndpointSlug,
  SANDBOX_HOOK_API_HOST,
  LOCAL_HOOK_API_HOST,
} from "../mission-control-hook-env";

describe("buildMissionControlApiUrl — host parameterization", () => {
  it("builds a loopback URL for the Electron host", () => {
    expect(buildMissionControlApiUrl(LOCAL_HOOK_API_HOST, 8080)).toBe("http://127.0.0.1:8080");
  });

  it("builds a host.docker.internal URL for the sandbox container", () => {
    expect(buildMissionControlApiUrl(SANDBOX_HOOK_API_HOST, 9333)).toBe(
      "http://host.docker.internal:9333",
    );
  });

  it("rejects hosts outside the allow-list", () => {
    expect(buildMissionControlApiUrl("evil.example.com", 9333)).toBeNull();
    expect(buildMissionControlApiUrl("10.0.0.1", 9333)).toBeNull();
  });

  it("rejects invalid ports", () => {
    expect(buildMissionControlApiUrl(LOCAL_HOOK_API_HOST, 0)).toBeNull();
    expect(buildMissionControlApiUrl(LOCAL_HOOK_API_HOST, -1)).toBeNull();
    expect(buildMissionControlApiUrl(LOCAL_HOOK_API_HOST, 70000)).toBeNull();
    expect(buildMissionControlApiUrl(LOCAL_HOOK_API_HOST, 1.5)).toBeNull();
    expect(buildMissionControlApiUrl(LOCAL_HOOK_API_HOST, null)).toBeNull();
    expect(buildMissionControlApiUrl(LOCAL_HOOK_API_HOST, undefined)).toBeNull();
  });
});

describe("host-specific convenience builders", () => {
  it("buildLocalMissionControlApiUrl targets loopback", () => {
    expect(buildLocalMissionControlApiUrl(8080)).toBe("http://127.0.0.1:8080");
    expect(buildLocalMissionControlApiUrl(0)).toBeNull();
  });

  it("buildSandboxMissionControlApiUrl targets host.docker.internal", () => {
    expect(buildSandboxMissionControlApiUrl(9333)).toBe("http://host.docker.internal:9333");
    expect(buildSandboxMissionControlApiUrl(0)).toBeNull();
  });

  it("buildAgentLocalHookApiUrl targets loopback agent HTTP", () => {
    expect(buildAgentLocalHookApiUrl(9333)).toBe("http://127.0.0.1:9333");
  });

  it("buildSandboxHookRelayUrl targets host MC hook API", () => {
    expect(buildSandboxHookRelayUrl(8080, "claude", "task-1", "Stop")).toBe(
      "http://127.0.0.1:8080/api/hooks/claude?taskId=task-1&hookEvent=Stop",
    );
  });
});

describe("buildSyntheticHookUrl — accepts both hosts", () => {
  it("accepts a loopback base", () => {
    const url = buildSyntheticHookUrl(
      { apiUrl: "http://127.0.0.1:8080", token: "t" },
      "claude-code",
      "task-1",
    );
    expect(url).toBe("http://127.0.0.1:8080/api/hooks/claude?taskId=task-1");
  });

  it("accepts a host.docker.internal base (sandbox)", () => {
    const url = buildSyntheticHookUrl(
      { apiUrl: "http://host.docker.internal:9333", token: "t" },
      "codex",
      "task-2",
    );
    expect(url).toBe("http://host.docker.internal:9333/api/hooks/codex?taskId=task-2");
  });

  it("rejects non-http, port-less, and off-allow-list hosts", () => {
    expect(
      buildSyntheticHookUrl({ apiUrl: "https://127.0.0.1:8080", token: "t" }, "claude-code", "x"),
    ).toBeNull();
    expect(
      buildSyntheticHookUrl({ apiUrl: "http://127.0.0.1", token: "t" }, "claude-code", "x"),
    ).toBeNull();
    expect(
      buildSyntheticHookUrl({ apiUrl: "http://evil.example.com:9333", token: "t" }, "claude-code", "x"),
    ).toBeNull();
    expect(buildSyntheticHookUrl({ apiUrl: "not a url", token: "t" }, "claude-code", "x")).toBeNull();
  });
});

describe("hookEndpointSlug", () => {
  it("maps agents to their hook endpoint slug", () => {
    expect(hookEndpointSlug("codex")).toBe("codex");
    expect(hookEndpointSlug("cursor-cli")).toBe("cursor");
    expect(hookEndpointSlug("opencode")).toBe("opencode");
    expect(hookEndpointSlug("claude-code")).toBe("claude");
    expect(hookEndpointSlug(undefined)).toBe("claude");
  });
});
