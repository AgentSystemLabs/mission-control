import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger";

type Captured = { line: string; parsed: any };

function captureStderr(): { captured: Captured[]; restore: () => void } {
  const captured: Captured[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (chunk: any) => {
    const line = typeof chunk === "string" ? chunk : chunk.toString();
    for (const raw of line.split("\n")) {
      if (!raw.trim()) continue;
      try {
        captured.push({ line: raw, parsed: JSON.parse(raw) });
      } catch {
        captured.push({ line: raw, parsed: null });
      }
    }
    return true;
  };
  return {
    captured,
    restore: () => {
      process.stderr.write = orig as any;
    },
  };
}

describe("logger", () => {
  const originalLevel = process.env.MC_LOG_LEVEL;

  beforeEach(() => {
    delete process.env.MC_LOG_LEVEL;
  });

  afterEach(() => {
    if (originalLevel === undefined) delete process.env.MC_LOG_LEVEL;
    else process.env.MC_LOG_LEVEL = originalLevel;
    vi.restoreAllMocks();
  });

  it("redacts licenseKey, apiToken, and token fields", () => {
    const { captured, restore } = captureStderr();
    logger.info("auth", {
      licenseKey: "sk-live-supersecret",
      apiToken: "tk_abc123",
      token: "bearer-xyz",
      keep: "visible",
    });
    restore();
    expect(captured).toHaveLength(1);
    const rec = captured[0]!.parsed;
    expect(rec.licenseKey).toBe("[redacted]");
    expect(rec.apiToken).toBe("[redacted]");
    expect(rec.token).toBe("[redacted]");
    expect(rec.keep).toBe("visible");
    expect(captured[0]!.line).not.toContain("supersecret");
    expect(captured[0]!.line).not.toContain("tk_abc123");
    expect(captured[0]!.line).not.toContain("bearer-xyz");
  });

  it("serializes Error fields as { message, stack, name }", () => {
    const { captured, restore } = captureStderr();
    const err = new Error("boom");
    err.name = "BoomError";
    logger.error("kaboom", { err });
    restore();
    const rec = captured[0]!.parsed;
    expect(rec.err.message).toBe("boom");
    expect(rec.err.name).toBe("BoomError");
    expect(typeof rec.err.stack).toBe("string");
    expect(rec.err.stack).toContain("boom");
  });

  it("respects MC_LOG_LEVEL gating", () => {
    process.env.MC_LOG_LEVEL = "warn";
    const { captured, restore } = captureStderr();
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    restore();
    const msgs = captured.map((c) => c.parsed.msg);
    expect(msgs).toEqual(["w", "e"]);
  });

  it("falls back to info when MC_LOG_LEVEL is unset", () => {
    const { captured, restore } = captureStderr();
    logger.debug("d");
    logger.info("i");
    restore();
    expect(captured.map((c) => c.parsed.msg)).toEqual(["i"]);
  });

  it("emits a single JSON line with t, level, msg", () => {
    const { captured, restore } = captureStderr();
    logger.info("hello", { a: 1 });
    restore();
    expect(captured).toHaveLength(1);
    const rec = captured[0]!.parsed;
    expect(rec.level).toBe("info");
    expect(rec.msg).toBe("hello");
    expect(rec.a).toBe(1);
    expect(typeof rec.t).toBe("string");
    expect(() => new Date(rec.t)).not.toThrow();
  });
});
