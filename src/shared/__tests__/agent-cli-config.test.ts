import { describe, expect, it } from "vitest";
import {
  AGENT_CLI_CONFIG,
  AGENT_SPAWN_COMMANDS,
  assertAgentCliRegistrySync,
  pathLookupCandidates,
  resolveAgentCliUpdateCommands,
} from "../agent-cli-config";
import { AGENT_REGISTRY } from "../agents";

describe("agent CLI config", () => {
  it("stays in sync with AGENT_REGISTRY command names", () => {
    expect(() => assertAgentCliRegistrySync(AGENT_REGISTRY)).not.toThrow();
  });

  it("defines spawn commands from the same canonical command field", () => {
    for (const [agent, config] of Object.entries(AGENT_CLI_CONFIG)) {
      expect(AGENT_SPAWN_COMMANDS[agent as keyof typeof AGENT_SPAWN_COMMANDS]).toBe(config.command);
    }
  });

  it("resolves Cursor CLI via agent alias candidates", () => {
    expect(pathLookupCandidates("cursor-agent")).toEqual(["cursor-agent", "agent"]);
    expect(pathLookupCandidates("agent")).toEqual(["cursor-agent", "agent"]);
  });

  it("declares an npm package for registry-published CLIs only", () => {
    expect(AGENT_CLI_CONFIG["claude-code"].npmPackage).toBe("@anthropic-ai/claude-code");
    expect(AGENT_CLI_CONFIG.codex.npmPackage).toBe("@openai/codex");
    expect(AGENT_CLI_CONFIG.opencode.npmPackage).toBe("opencode-ai");
    expect(AGENT_CLI_CONFIG["cursor-cli"].npmPackage).toBeUndefined();
  });

  it("returns platform-specific install commands", () => {
    expect(resolveAgentCliUpdateCommands(AGENT_CLI_CONFIG["cursor-cli"].updateCommands, "win32")).toEqual([
      "irm 'https://cursor.com/install?win32=true' | iex",
      "agent update",
    ]);
    expect(resolveAgentCliUpdateCommands(AGENT_CLI_CONFIG.opencode.updateCommands, "win32")).toEqual([
      "npm i -g opencode-ai@latest",
      "opencode upgrade",
    ]);
  });
});
