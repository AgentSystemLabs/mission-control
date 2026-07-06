import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureRecallMcpForAgent } from "../ensure-recall-mcp";

// The repo root, where bundled-mcp/recall-mcp.mjs lives (dev resolution).
const APP_PATH = path.resolve(__dirname, "..", "..");

function tmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mc-mcp-cfg-"));
}

function readConfig(cwd: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
}

describe("ensureRecallMcpForAgent", () => {
  it("writes a marker-managed recall server for claude-code", () => {
    const cwd = tmpCwd();
    ensureRecallMcpForAgent(APP_PATH, cwd, "claude-code");
    const cfg = readConfig(cwd);
    expect(cfg.mcpServers["recall"].command).toBe("node");
    expect(cfg.mcpServers["recall"].args[0]).toMatch(/recall-mcp\.mjs$/);
    expect(cfg.mcpServers["recall"].env.MC_API_URL).toContain("MC_API_URL");
  });

  it("removes the legacy recall-graph entry on upgrade, keeping user servers", () => {
    const cwd = tmpCwd();
    fs.writeFileSync(
      path.join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "recall-graph": { command: "node", args: ["/old/recall-graph-mcp.mjs"] },
          other: { command: "foo", args: [] },
        },
      }),
    );
    ensureRecallMcpForAgent(APP_PATH, cwd, "claude-code");
    const cfg = readConfig(cwd);
    expect(cfg.mcpServers["recall-graph"]).toBeUndefined();
    expect(cfg.mcpServers["recall"]).toBeTruthy();
    expect(cfg.mcpServers.other.command).toBe("foo");
  });

  it("preserves other servers and top-level keys", () => {
    const cwd = tmpCwd();
    fs.writeFileSync(
      path.join(cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "foo", args: [] } }, someUserKey: 1 }),
    );
    ensureRecallMcpForAgent(APP_PATH, cwd, "claude-code");
    const cfg = readConfig(cwd);
    expect(cfg.mcpServers.other.command).toBe("foo");
    expect(cfg.someUserKey).toBe(1);
    expect(cfg.mcpServers["recall"]).toBeTruthy();
  });

  it("is a no-op for non-claude agents", () => {
    const cwd = tmpCwd();
    ensureRecallMcpForAgent(APP_PATH, cwd, "codex");
    expect(fs.existsSync(path.join(cwd, ".mcp.json"))).toBe(false);
  });

  it("is idempotent (no duplicate / churn on repeat)", () => {
    const cwd = tmpCwd();
    ensureRecallMcpForAgent(APP_PATH, cwd, "claude-code");
    const first = fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8");
    ensureRecallMcpForAgent(APP_PATH, cwd, "claude-code");
    const second = fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8");
    expect(second).toBe(first);
  });

  it("tolerates a corrupt existing .mcp.json without throwing", () => {
    const cwd = tmpCwd();
    fs.writeFileSync(path.join(cwd, ".mcp.json"), "{ not valid json");
    expect(() => ensureRecallMcpForAgent(APP_PATH, cwd, "claude-code")).not.toThrow();
    const cfg = readConfig(cwd);
    expect(cfg.mcpServers["recall"]).toBeTruthy();
  });
});
