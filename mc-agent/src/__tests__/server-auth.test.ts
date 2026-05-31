import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { isPaired } from "../server";
import type { AgentConfig } from "../config";

function config(): AgentConfig {
  return {
    port: 9333,
    bindHost: "0.0.0.0",
    workspaceRoot: "/workspace",
    pairingToken: "secret",
    hookApiHost: "host.docker.internal",
    allowInsecure: false,
  };
}

function req(headers: Record<string, string>, url = "/"): IncomingMessage {
  return { headers, url } as IncomingMessage;
}

describe("agent WebSocket auth", () => {
  it("accepts bearer authorization", () => {
    expect(isPaired(req({ authorization: "Bearer secret" }), config())).toBe(true);
  });

  it("rejects query-string tokens", () => {
    expect(isPaired(req({}, "/?token=secret"), config())).toBe(false);
  });
});
