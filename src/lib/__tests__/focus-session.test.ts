import { describe, it, expect, vi } from "vitest";
import {
  isFocusPath,
  resolveReturnPath,
  setPendingRefocus,
  takePendingRefocus,
} from "~/lib/focus-session";

describe("isFocusPath", () => {
  it("matches focus routes", () => {
    expect(isFocusPath("/focus/abc123")).toBe(true);
    expect(isFocusPath("/focus")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isFocusPath("/")).toBe(false);
    expect(isFocusPath("/projects/abc")).toBe(false);
    expect(isFocusPath("/settings")).toBe(false);
    expect(isFocusPath("/focused")).toBe(false);
  });
});

describe("resolveReturnPath", () => {
  it("returns the stored path when usable", () => {
    expect(resolveReturnPath("/projects/abc")).toBe("/projects/abc");
    expect(resolveReturnPath("/projects/abc?tab=diff")).toBe("/projects/abc?tab=diff");
  });

  it("falls back to home when nothing was stored", () => {
    expect(resolveReturnPath(null)).toBe("/");
    expect(resolveReturnPath("")).toBe("/");
  });

  it("falls back to home for non-path or focus-path values", () => {
    expect(resolveReturnPath("https://evil.example")).toBe("/");
    expect(resolveReturnPath("/focus/abc")).toBe("/");
  });
});

describe("pending refocus", () => {
  it("is consumed once by the matching task", () => {
    setPendingRefocus("t1");
    expect(takePendingRefocus("t1")).toBe(true);
    expect(takePendingRefocus("t1")).toBe(false);
  });

  it("is kept for the matching task when another pane asks", () => {
    setPendingRefocus("t1");
    expect(takePendingRefocus("other")).toBe(false);
    expect(takePendingRefocus("t1")).toBe(true);
  });

  it("expires when no pane consumed it in time", () => {
    vi.useFakeTimers();
    try {
      setPendingRefocus("t1");
      vi.advanceTimersByTime(3_001);
      expect(takePendingRefocus("t1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a newer request replaces an older one", () => {
    setPendingRefocus("t1");
    setPendingRefocus("t2");
    expect(takePendingRefocus("t1")).toBe(false);
    expect(takePendingRefocus("t2")).toBe(true);
  });
});
