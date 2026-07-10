import { describe, expect, it } from "vitest";
import { AGENT_CLI_CONFIG, resolveAgentCliUpdateCommands } from "../agent-cli-config";
import { detectAgentCliInstallMethod, selectAgentCliUpdateCommand } from "../agent-cli-update";
import type { TaskAgent } from "../domain";

function commandsFor(agent: TaskAgent, platform: NodeJS.Platform): readonly string[] {
  return resolveAgentCliUpdateCommands(AGENT_CLI_CONFIG[agent].updateCommands, platform);
}

describe("detectAgentCliInstallMethod", () => {
  it("classifies npm global installs, including brew-node prefixes", () => {
    expect(
      detectAgentCliInstallMethod("/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js"),
    ).toBe("npm");
    // A brew-installed node's global prefix still means npm manages the CLI.
    expect(
      detectAgentCliInstallMethod("/opt/homebrew/lib/node_modules/opencode-ai/bin/opencode"),
    ).toBe("npm");
    expect(
      detectAgentCliInstallMethod(
        "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
      ),
    ).toBe("npm");
  });

  it("classifies homebrew formula installs", () => {
    expect(detectAgentCliInstallMethod("/opt/homebrew/Cellar/codex/0.144.1/bin/codex")).toBe(
      "homebrew",
    );
    expect(
      detectAgentCliInstallMethod("/home/linuxbrew/.linuxbrew/Cellar/codex/0.1/bin/codex"),
    ).toBe("homebrew");
  });

  it("classifies vendor installer locations as other", () => {
    expect(detectAgentCliInstallMethod("/Users/me/.opencode/bin/opencode")).toBe("other");
    expect(detectAgentCliInstallMethod("/Users/me/.local/bin/claude")).toBe("other");
  });
});

describe("selectAgentCliUpdateCommand", () => {
  it("updates npm installs via npm", () => {
    expect(selectAgentCliUpdateCommand(commandsFor("claude-code", "darwin"), "npm", ["claude"])).toBe(
      "npm install -g @anthropic-ai/claude-code@latest",
    );
    expect(selectAgentCliUpdateCommand(commandsFor("opencode", "darwin"), "npm", ["opencode"])).toBe(
      "npm i -g opencode-ai@latest",
    );
  });

  it("updates homebrew installs via brew", () => {
    expect(selectAgentCliUpdateCommand(commandsFor("codex", "darwin"), "homebrew", ["codex"])).toBe(
      "brew upgrade codex",
    );
  });

  it("prefers the CLI's own self-updater when the install method is unknown", () => {
    expect(selectAgentCliUpdateCommand(commandsFor("claude-code", "darwin"), "other", ["claude"])).toBe(
      "claude update",
    );
    expect(selectAgentCliUpdateCommand(commandsFor("opencode", "darwin"), "other", ["opencode"])).toBe(
      "opencode upgrade",
    );
    expect(
      selectAgentCliUpdateCommand(commandsFor("cursor-cli", "darwin"), "other", [
        "cursor-agent",
        "agent",
      ]),
    ).toBe("agent update");
  });

  it("falls back to npm, then the first command, when nothing matches the method", () => {
    // codex has no self-updater or installer script — unknown installs use npm.
    expect(selectAgentCliUpdateCommand(commandsFor("codex", "darwin"), "other", ["codex"])).toBe(
      "npm install -g @openai/codex@latest",
    );
    expect(selectAgentCliUpdateCommand([], "other", ["x"])).toBeNull();
  });

  it("picks the PowerShell installer for unknown Windows cursor installs", () => {
    expect(
      selectAgentCliUpdateCommand(commandsFor("cursor-cli", "win32"), "other", ["cursor-agent", "agent"]),
    ).toBe("agent update");
  });
});
