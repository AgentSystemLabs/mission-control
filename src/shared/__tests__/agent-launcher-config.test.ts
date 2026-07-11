import { describe, expect, it } from "vitest";
import { TASK_AGENTS } from "../domain";
import {
  DEFAULT_AGENT_LAUNCHER_CONFIG,
  normalizeAgentLauncherConfig,
  visibleLauncherAgents,
} from "../agent-launcher-config";

describe("normalizeAgentLauncherConfig", () => {
  it("returns the default config for garbage input", () => {
    for (const raw of [null, undefined, 42, "codex", [], { order: "codex" }]) {
      expect(normalizeAgentLauncherConfig(raw)).toEqual(DEFAULT_AGENT_LAUNCHER_CONFIG);
    }
  });

  it("drops unknown ids and duplicates", () => {
    const result = normalizeAgentLauncherConfig({
      order: ["codex", "not-an-agent", "codex", "claude-code"],
      hidden: ["nope", "opencode", "opencode"],
    });
    expect(result.order).toEqual(["codex", "claude-code", "cursor-cli", "opencode"]);
    expect(result.hidden).toEqual(["opencode"]);
  });

  it("appends agents missing from order in default order", () => {
    const result = normalizeAgentLauncherConfig({ order: ["opencode"], hidden: [] });
    expect(result.order).toEqual(["opencode", "claude-code", "codex", "cursor-cli"]);
  });

  it("keeps at least one agent visible when everything is hidden", () => {
    const result = normalizeAgentLauncherConfig({
      order: ["cursor-cli", "codex", "claude-code", "opencode"],
      hidden: [...TASK_AGENTS],
    });
    expect(result.hidden).not.toContain("cursor-cli");
    expect(visibleLauncherAgents(result)).toEqual(["cursor-cli"]);
  });

  it("returns fresh arrays that do not alias the default config", () => {
    const result = normalizeAgentLauncherConfig(null);
    result.order.push("codex");
    expect(DEFAULT_AGENT_LAUNCHER_CONFIG.order).toEqual([...TASK_AGENTS]);
  });
});

describe("visibleLauncherAgents", () => {
  it("filters hidden agents preserving order", () => {
    expect(
      visibleLauncherAgents({
        order: ["codex", "claude-code", "cursor-cli", "opencode"],
        hidden: ["claude-code", "opencode"],
      }),
    ).toEqual(["codex", "cursor-cli"]);
  });

  it("returns everything when nothing is hidden", () => {
    expect(visibleLauncherAgents(DEFAULT_AGENT_LAUNCHER_CONFIG)).toEqual([...TASK_AGENTS]);
  });
});
