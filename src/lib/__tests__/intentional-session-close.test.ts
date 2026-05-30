import { describe, expect, it, beforeEach } from "vitest";
import {
  clearIntentionalSessionCloses,
  consumeIntentionalSessionClose,
  markIntentionalSessionClose,
} from "~/lib/intentional-session-close";

describe("intentional-session-close", () => {
  beforeEach(() => {
    clearIntentionalSessionCloses();
  });

  it("consumes a marked close once", () => {
    markIntentionalSessionClose("task-1");
    expect(consumeIntentionalSessionClose("task-1")).toBe(true);
    expect(consumeIntentionalSessionClose("task-1")).toBe(false);
  });

  it("returns false for unmarked task ids", () => {
    expect(consumeIntentionalSessionClose("task-2")).toBe(false);
  });
});
