import { describe, expect, it, vi } from "vitest";
import { resizePtyToTerminal } from "../terminal-resize";

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
