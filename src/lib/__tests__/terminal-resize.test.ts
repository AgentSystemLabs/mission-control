import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSettledFit,
  createSettledPtyResize,
  PTY_RESIZE_SETTLE_MS,
  resizePtyToTerminal,
  SURFACE_FIT_SETTLE_MS,
} from "../terminal-resize";

describe("resizePtyToTerminal", () => {
  it("normalizes the visible terminal dimensions before resizing the PTY", () => {
    const resize = vi.fn();

    resizePtyToTerminal({ cols: 142.8, rows: 41.2 }, resize);

    expect(resize).toHaveBeenCalledWith(142, 41);
  });

  it("clamps unusable dimensions to PTY-safe bounds", () => {
    const resize = vi.fn();

    resizePtyToTerminal({ cols: 0, rows: 3 }, resize);

    expect(resize).toHaveBeenCalledWith(10, 10);
  });
});

describe("createSettledPtyResize", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("collapses a resize storm into one call with the final size", () => {
    const resize = vi.fn();
    const settled = createSettledPtyResize(resize);

    // A grid drag: xterm fires resize on every cell-boundary crossing.
    for (let cols = 80; cols <= 120; cols += 1) {
      settled.schedule({ cols, rows: 30 });
      vi.advanceTimersByTime(16);
    }
    expect(resize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PTY_RESIZE_SETTLE_MS);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(120, 30);
  });

  it("normalizes the scheduled size to PTY-safe bounds", () => {
    const resize = vi.fn();
    const settled = createSettledPtyResize(resize);

    settled.schedule({ cols: 0, rows: 3 });
    vi.advanceTimersByTime(PTY_RESIZE_SETTLE_MS);

    expect(resize).toHaveBeenCalledWith(10, 10);
  });

  it("fires again for a later, separate resize", () => {
    const resize = vi.fn();
    const settled = createSettledPtyResize(resize);

    settled.schedule({ cols: 100, rows: 30 });
    vi.advanceTimersByTime(PTY_RESIZE_SETTLE_MS);
    settled.schedule({ cols: 90, rows: 24 });
    vi.advanceTimersByTime(PTY_RESIZE_SETTLE_MS);

    expect(resize).toHaveBeenNthCalledWith(1, 100, 30);
    expect(resize).toHaveBeenNthCalledWith(2, 90, 24);
  });

  it("cancel drops the pending resize", () => {
    const resize = vi.fn();
    const settled = createSettledPtyResize(resize);

    settled.schedule({ cols: 100, rows: 30 });
    settled.cancel();
    vi.advanceTimersByTime(PTY_RESIZE_SETTLE_MS * 2);

    expect(resize).not.toHaveBeenCalled();
  });
});

describe("createSettledFit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds the refit while resize events keep arriving, then fits once", () => {
    const fit = vi.fn();
    const settled = createSettledFit(fit);

    // Continuous drag: ResizeObserver fires every frame.
    for (let i = 0; i < 60; i += 1) {
      settled.schedule();
      vi.advanceTimersByTime(16);
    }
    expect(fit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SURFACE_FIT_SETTLE_MS);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the pending fit", () => {
    const fit = vi.fn();
    const settled = createSettledFit(fit);

    settled.schedule();
    settled.cancel();
    vi.advanceTimersByTime(SURFACE_FIT_SETTLE_MS * 2);

    expect(fit).not.toHaveBeenCalled();
  });
});
