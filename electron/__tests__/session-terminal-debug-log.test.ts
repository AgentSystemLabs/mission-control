import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetSessionTerminalDebugLogForTesting,
  clearSessionTerminalDebugLogs,
  listSessionTerminalDebugLogs,
  recordSessionTerminalDebugLog,
} from "../session-terminal-debug-log";

describe("session terminal debug log", () => {
  beforeEach(() => {
    __resetSessionTerminalDebugLogForTesting();
  });

  it("stores newest entries first for the settings diagnostics view", () => {
    recordSessionTerminalDebugLog({
      stage: "native-spawn-failed",
      message: "first",
      taskId: "t1",
    });
    recordSessionTerminalDebugLog({
      stage: "session-fast-exit",
      message: "second",
      taskId: "t2",
    });

    const entries = listSessionTerminalDebugLogs();
    expect(entries.map((entry) => entry.message)).toEqual(["second", "first"]);
  });

  it("redacts session ids and bearer tokens from fields users may share", () => {
    recordSessionTerminalDebugLog({
      stage: "terminal-pane-start-failed",
      message: "failed for Bearer secret-token",
      command: "claude --resume 00000000-0000-4000-8000-000000000000",
      outputTail: "MC_API_TOKEN=abc123\nAuthorization: Bearer another-secret",
      details: {
        url: "http://127.0.0.1/api/hooks/codex?taskId=t1&token=hunter2",
      },
    });

    const [entry] = listSessionTerminalDebugLogs();
    const serialized = JSON.stringify(entry);
    expect(serialized).toContain("[uuid]");
    expect(serialized).toContain("Bearer [redacted]");
    expect(serialized).toContain("token=[redacted]");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("secret-token");
  });

  it("keeps only a bounded in-memory ring", () => {
    for (let i = 0; i < 120; i += 1) {
      recordSessionTerminalDebugLog({
        stage: "session-fast-exit",
        message: `entry-${i}`,
      });
    }

    const entries = listSessionTerminalDebugLogs();
    expect(entries).toHaveLength(100);
    expect(entries[0]?.message).toBe("entry-119");
    expect(entries.at(-1)?.message).toBe("entry-20");
  });

  it("clears the in-memory log", () => {
    recordSessionTerminalDebugLog({ stage: "x", message: "y" });
    clearSessionTerminalDebugLogs();
    expect(listSessionTerminalDebugLogs()).toEqual([]);
  });
});
