import { describe, expect, it } from "vitest";
import { defaultSessionPayload } from "../session-warm-pool";

describe("session-warm-pool", () => {
  it("builds default payload from saved agent settings", () => {
    expect(
      defaultSessionPayload({
        branch: "main",
        rememberAgentSettings: true,
        savedAgent: "codex",
        savedSkipPermissions: true,
      }),
    ).toEqual({
      agent: "codex",
      branch: "main",
      skipPermissions: true,
      bareSession: false,
    });
  });

  it("falls back to claude-code when nothing is saved", () => {
    expect(
      defaultSessionPayload({
        branch: "dev",
        rememberAgentSettings: false,
      }),
    ).toEqual({
      agent: "claude-code",
      branch: "dev",
      skipPermissions: false,
      bareSession: false,
    });
  });
});
