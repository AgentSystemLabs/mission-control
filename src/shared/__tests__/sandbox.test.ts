import { describe, expect, it } from "vitest";
import { filterProjectsByScope, LOCAL_SCOPE_ID, normalizeRemoteAgentUrl } from "../sandbox";

describe("normalizeRemoteAgentUrl", () => {
  it("normalizes HTTP(S) remote agent URLs to WebSocket URLs", () => {
    expect(normalizeRemoteAgentUrl("https://agent.example.com")).toBe("wss://agent.example.com/");
    expect(normalizeRemoteAgentUrl("http://localhost:9333")).toBe("ws://localhost:9333/");
  });

  it("accepts explicit WebSocket URLs and rejects unsupported schemes", () => {
    expect(normalizeRemoteAgentUrl("wss://agent.example.com/ws")).toBe("wss://agent.example.com/ws");
    expect(normalizeRemoteAgentUrl("ftp://agent.example.com")).toBeNull();
  });

  it("rejects remote agent URLs with embedded credentials or query secrets", () => {
    expect(normalizeRemoteAgentUrl("http://agent.example.com")).toBeNull();
    expect(normalizeRemoteAgentUrl("ws://agent.example.com")).toBeNull();
    expect(normalizeRemoteAgentUrl("http://192.168.1.10:9333")).toBeNull();
    expect(normalizeRemoteAgentUrl("https://user:pass@agent.example.com")).toBeNull();
    expect(normalizeRemoteAgentUrl("https://agent.example.com?token=secret")).toBeNull();
  });

  it("allows managed VM plaintext public WebSocket URLs when explicitly requested", () => {
    expect(normalizeRemoteAgentUrl("http://203.0.113.10:9333", { allowPlaintextPublic: true })).toBe(
      "ws://203.0.113.10:9333/",
    );
  });
});

describe("filterProjectsByScope", () => {
  const projects = [
    { id: "local-a", sandboxId: null },
    { id: "local-b", sandboxId: null },
    { id: "sb-1-a", sandboxId: "sb-1" },
    { id: "sb-2-a", sandboxId: "sb-2" },
  ];

  it("returns all projects when sandboxes are disabled", () => {
    expect(filterProjectsByScope(projects, { enabled: false, activeScopeId: "sb-1" })).toEqual(
      projects,
    );
    expect(filterProjectsByScope(projects, undefined)).toEqual(projects);
  });

  it("filters to Local or the active sandbox when sandboxes are enabled", () => {
    expect(
      filterProjectsByScope(projects, { enabled: true, activeScopeId: LOCAL_SCOPE_ID }),
    ).toEqual([projects[0], projects[1]]);
    expect(filterProjectsByScope(projects, { enabled: true, activeScopeId: "sb-1" })).toEqual([
      projects[2],
    ]);
  });
});
