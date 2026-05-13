import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-token-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { issueTaskToken, verifyTaskToken } = await import("../task-token");

describe("task-token", () => {
  it("verifies a freshly issued token for its taskId", () => {
    const token = issueTaskToken("task-abc");
    const result = verifyTaskToken(token, "task-abc");
    expect(result.ok).toBe(true);
  });

  it("rejects a token whose taskId does not match the required one", () => {
    const token = issueTaskToken("task-abc");
    const result = verifyTaskToken(token, "task-xyz");
    expect(result).toEqual({ ok: false, reason: "task_mismatch" });
  });

  it("rejects an expired token", () => {
    const token = issueTaskToken("task-abc", -1_000);
    const result = verifyTaskToken(token, "task-abc");
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token whose HMAC has been tampered with", () => {
    const token = issueTaskToken("task-abc");
    const parts = token.split(".");
    // Flip one character of the signature segment to invalidate the HMAC
    // while keeping the length and base64url alphabet intact.
    const sig = parts[3]!;
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    const tampered = [parts[0], parts[1], parts[2], flipped].join(".");
    const result = verifyTaskToken(tampered, "task-abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature");
  });

  it("rejects malformed tokens", () => {
    expect(verifyTaskToken("", "task-abc").ok).toBe(false);
    expect(verifyTaskToken("not.a.token", "task-abc").ok).toBe(false);
    expect(verifyTaskToken("v2.task-abc.123.sig", "task-abc").ok).toBe(false);
  });
});
