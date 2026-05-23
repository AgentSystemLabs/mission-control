import { describe, expect, it } from "vitest";
import { AGENT_REGISTRY, UI_AGENTS } from "../agents";

describe("agent registry", () => {
  it("launches Codex with current hook support enabled", () => {
    expect(AGENT_REGISTRY.codex.startCommand()).toBe("codex --enable hooks");
    expect(AGENT_REGISTRY.codex.startCommand({ skipPermissions: true })).toBe(
      "codex --enable hooks --yolo"
    );
  });

  it("exposes Cursor CLI as a selectable agent", () => {
    expect(UI_AGENTS).toContain("cursor-cli");
    expect(AGENT_REGISTRY["cursor-cli"]).toMatchObject({
      command: "cursor-agent",
      uiVisible: true,
      supportsSkipPermissions: true,
    });
    expect(AGENT_REGISTRY["cursor-cli"].disabled).toBeUndefined();
    expect(AGENT_REGISTRY["cursor-cli"].startCommand()).toBe("cursor-agent");
    expect(AGENT_REGISTRY["cursor-cli"].startCommand({ skipPermissions: true })).toBe(
      "cursor-agent --force"
    );
  });

  it("exposes OpenCode as a selectable agent", () => {
    expect(UI_AGENTS).toContain("opencode");
    expect(AGENT_REGISTRY.opencode).toMatchObject({
      command: "opencode",
      uiVisible: true,
      supportsSkipPermissions: false,
    });
    expect(AGENT_REGISTRY.opencode.startCommand()).toBe("opencode");
    expect(AGENT_REGISTRY.opencode.titleInvocation?.("name this task")).toEqual({
      cmd: "opencode",
      args: ["run", "name this task"],
    });
  });
});
