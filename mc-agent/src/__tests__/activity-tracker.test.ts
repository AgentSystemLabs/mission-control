import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ActivityTracker } from "../activity-tracker";

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-activity-"));
  return path.join(dir, "nested", "activity");
}

describe("ActivityTracker", () => {
  it("writes the heartbeat file (creating parent dirs) on touchNow", () => {
    const file = tmpFile();
    let now = 1_000;
    const tracker = new ActivityTracker(file, 15_000, () => now);
    tracker.touchNow();
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8").trim()).toBe("1000");
  });

  it("throttles touch() so chatty I/O doesn't rewrite every event", () => {
    const file = tmpFile();
    let now = 1_000;
    const tracker = new ActivityTracker(file, 15_000, () => now);
    tracker.touch();
    expect(fs.readFileSync(file, "utf8").trim()).toBe("1000");
    now = 5_000; // within the throttle window — no write
    tracker.touch();
    expect(fs.readFileSync(file, "utf8").trim()).toBe("1000");
    now = 20_000; // past the throttle window — writes
    tracker.touch();
    expect(fs.readFileSync(file, "utf8").trim()).toBe("20000");
  });

  it("touchNow ignores the throttle", () => {
    const file = tmpFile();
    let now = 1_000;
    const tracker = new ActivityTracker(file, 15_000, () => now);
    tracker.touchNow();
    now = 1_500;
    tracker.touchNow();
    expect(fs.readFileSync(file, "utf8").trim()).toBe("1500");
  });

  it("is a no-op when no activity file is configured", () => {
    const tracker = new ActivityTracker("", 15_000, () => 1_000);
    // Must not throw and must not create anything.
    expect(() => {
      tracker.touchNow();
      tracker.touch();
    }).not.toThrow();
  });
});
