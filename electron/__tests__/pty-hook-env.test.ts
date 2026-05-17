import { describe, expect, it } from "vitest";
import {
  buildLocalMissionControlApiUrl,
  buildSyntheticHookUrl,
} from "../pty-hook-env";

describe("PTY hook env", () => {
  it("builds Mission Control API URLs only for valid local ports", () => {
    expect(buildLocalMissionControlApiUrl(5173)).toBe("http://127.0.0.1:5173");
    expect(buildLocalMissionControlApiUrl(null)).toBeNull();
    expect(buildLocalMissionControlApiUrl(0)).toBeNull();
    expect(buildLocalMissionControlApiUrl(65536)).toBeNull();
  });

  it("builds synthetic hook URLs from a loopback Mission Control origin", () => {
    expect(
      buildSyntheticHookUrl(
        { apiUrl: "http://127.0.0.1:5173", token: "secret" },
        "codex",
        "task 1",
      ),
    ).toBe("http://127.0.0.1:5173/api/hooks/codex?taskId=task+1");
  });

  it("rejects renderer-style attacker and internal-network hook origins", () => {
    for (const apiUrl of [
      "https://127.0.0.1:5173",
      "http://localhost:5173",
      "http://attacker.test",
      "http://169.254.169.254",
      "http://192.168.1.1",
    ]) {
      expect(
        buildSyntheticHookUrl({ apiUrl, token: "secret" }, "claude-code", "task"),
      ).toBeNull();
    }
  });
});
