import { describe, expect, it } from "vitest";
import { buildClaudeCommand } from "../claude-command";

describe("buildClaudeCommand", () => {
  it("includes --bare for new Claude sessions when requested", () => {
    expect(
      buildClaudeCommand({
        kind: "new",
        sessionId: "00000000-0000-4000-8000-000000000000",
        skipPermissions: false,
        bareSession: true,
      })
    ).toBe("claude --bare --session-id 00000000-0000-4000-8000-000000000000");
  });

  it("emits the permission-bypass flag when explicitly requested", () => {
    expect(
      buildClaudeCommand({
        kind: "resume",
        sessionId: "00000000-0000-4000-8000-000000000000",
        skipPermissions: true,
        bareSession: true,
      })
    ).toBe(
      "claude --bare --resume 00000000-0000-4000-8000-000000000000 --dangerously-skip-permissions"
    );
  });
});
