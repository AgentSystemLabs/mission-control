import { describe, expect, it } from "vitest";
import { AGENT_REGISTRY, UI_AGENTS } from "../agents";

describe("agent registry", () => {
  it("exposes Cursor CLI as a selectable agent", () => {
    expect(UI_AGENTS).toContain("cursor-cli");
    expect(AGENT_REGISTRY["cursor-cli"]).toMatchObject({
      command: "cursor-agent",
      uiVisible: true,
      supportsSkipPermissions: true,
      skipPermissionsFlag: "--force",
    });
    expect(AGENT_REGISTRY["cursor-cli"].disabled).toBeUndefined();
    expect(AGENT_REGISTRY["cursor-cli"].startCommand()).toBe("cursor-agent");
    expect(AGENT_REGISTRY["cursor-cli"].startCommand({ skipPermissions: true })).toBe(
      "cursor-agent --force"
    );
  });
});
