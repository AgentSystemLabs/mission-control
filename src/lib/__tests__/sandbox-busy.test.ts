import { describe, it, expect } from "vitest";
import { setSandboxBusyState, type SandboxBusyMap } from "../sandbox-busy";

describe("setSandboxBusyState", () => {
  it("tracks multiple sandboxes as busy concurrently and independently", () => {
    // Stop A, then (before A finishes) stop B — both must be busy at once.
    let map: SandboxBusyMap = {};
    map = setSandboxBusyState(map, "sb-a", "pausing");
    map = setSandboxBusyState(map, "sb-b", "pausing");
    expect(map).toEqual({ "sb-a": "pausing", "sb-b": "pausing" });
  });

  it("clearing one sandbox leaves the others untouched", () => {
    const map = setSandboxBusyState(
      { "sb-a": "pausing", "sb-b": "destroying" },
      "sb-a",
      null,
    );
    expect(map).toEqual({ "sb-b": "destroying" });
  });

  it("does not mutate the previous map (immutable update)", () => {
    const prev: SandboxBusyMap = { "sb-a": "pausing" };
    const next = setSandboxBusyState(prev, "sb-b", "destroying");
    expect(prev).toEqual({ "sb-a": "pausing" });
    expect(next).not.toBe(prev);
  });

  it("returns the same reference when clearing an id that isn't busy (no-op render)", () => {
    const prev: SandboxBusyMap = { "sb-a": "pausing" };
    expect(setSandboxBusyState(prev, "sb-missing", null)).toBe(prev);
  });

  it("overwrites a sandbox's own state without affecting siblings", () => {
    const map = setSandboxBusyState({ "sb-a": "pausing", "sb-b": "pausing" }, "sb-a", "destroying");
    expect(map).toEqual({ "sb-a": "destroying", "sb-b": "pausing" });
  });
});
