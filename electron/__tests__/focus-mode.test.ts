import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  screen: { getAllDisplays: vi.fn(), getDisplayMatching: vi.fn() },
}));
vi.mock("electron-log/main", () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("../app-settings-store", () => ({
  getStringAppSetting: vi.fn(() => null),
  setAppSetting: vi.fn(),
}));

import {
  boundsSettled,
  defaultFloatingBounds,
  parsePersistedBounds,
  resolveFloatingBounds,
  FOCUS_WINDOW_DEFAULT_WIDTH,
  FOCUS_WINDOW_DEFAULT_HEIGHT,
  FOCUS_WINDOW_MIN_WIDTH,
  FOCUS_WINDOW_MIN_HEIGHT,
  FOCUS_WINDOW_MARGIN,
} from "../focus-mode";

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1055 };

describe("defaultFloatingBounds", () => {
  it("places the card in the bottom-right with a margin", () => {
    const b = defaultFloatingBounds(PRIMARY);
    expect(b).toEqual({
      x: 1920 - FOCUS_WINDOW_DEFAULT_WIDTH - FOCUS_WINDOW_MARGIN,
      y: 1055 - FOCUS_WINDOW_DEFAULT_HEIGHT - FOCUS_WINDOW_MARGIN,
      width: FOCUS_WINDOW_DEFAULT_WIDTH,
      height: FOCUS_WINDOW_DEFAULT_HEIGHT,
    });
  });

  it("honors the work-area origin of a secondary display", () => {
    const secondary = { x: 1920, y: 200, width: 1440, height: 900 };
    const b = defaultFloatingBounds(secondary);
    expect(b.x).toBe(1920 + 1440 - FOCUS_WINDOW_DEFAULT_WIDTH - FOCUS_WINDOW_MARGIN);
    expect(b.y).toBe(200 + 900 - FOCUS_WINDOW_DEFAULT_HEIGHT - FOCUS_WINDOW_MARGIN);
  });

  it("never places the card outside a tiny work area", () => {
    const tiny = { x: 0, y: 0, width: 300, height: 200 };
    const b = defaultFloatingBounds(tiny);
    expect(b.x).toBeGreaterThanOrEqual(tiny.x);
    expect(b.y).toBeGreaterThanOrEqual(tiny.y);
    expect(b.width).toBeLessThanOrEqual(tiny.width);
    expect(b.height).toBeLessThanOrEqual(tiny.height);
  });
});

describe("parsePersistedBounds", () => {
  it("round-trips valid bounds", () => {
    const bounds = { x: 100, y: 60, width: 420, height: 300 };
    expect(parsePersistedBounds(JSON.stringify(bounds))).toEqual(bounds);
  });

  it("returns null for null/garbage/non-object input", () => {
    expect(parsePersistedBounds(null)).toBeNull();
    expect(parsePersistedBounds("not json")).toBeNull();
    expect(parsePersistedBounds("42")).toBeNull();
    expect(parsePersistedBounds("null")).toBeNull();
  });

  it("rejects non-finite or missing fields", () => {
    expect(parsePersistedBounds(JSON.stringify({ x: 0, y: 0, width: 420 }))).toBeNull();
    expect(
      parsePersistedBounds(JSON.stringify({ x: 0, y: 0, width: "420", height: 300 })),
    ).toBeNull();
    expect(parsePersistedBounds('{"x":null,"y":0,"width":420,"height":300}')).toBeNull();
  });

  it("rejects bounds smaller than the floating minimum", () => {
    expect(
      parsePersistedBounds(
        JSON.stringify({ x: 0, y: 0, width: FOCUS_WINDOW_MIN_WIDTH - 1, height: 300 }),
      ),
    ).toBeNull();
    expect(
      parsePersistedBounds(
        JSON.stringify({ x: 0, y: 0, width: 420, height: FOCUS_WINDOW_MIN_HEIGHT - 1 }),
      ),
    ).toBeNull();
  });
});

describe("boundsSettled", () => {
  const target = { x: 100, y: 200, width: 560, height: 850 };

  it("accepts an exact match and off-by-one rounding on every edge", () => {
    expect(boundsSettled(target, target)).toBe(true);
    expect(boundsSettled({ x: 101, y: 199, width: 561, height: 849 }, target)).toBe(true);
  });

  it("rejects a frame still more than a pixel away (animation in flight)", () => {
    expect(boundsSettled({ ...target, x: 102 }, target)).toBe(false);
    expect(boundsSettled({ ...target, width: 558 }, target)).toBe(false);
  });
});

describe("resolveFloatingBounds", () => {
  it("keeps saved bounds that are visible on some display", () => {
    const saved = { x: 1400, y: 700, width: 420, height: 300 };
    expect(resolveFloatingBounds(saved, [PRIMARY], PRIMARY)).toEqual(saved);
  });

  it("falls back to the default when saved bounds are off-screen (monitor unplugged)", () => {
    const saved = { x: 3000, y: 700, width: 420, height: 300 };
    expect(resolveFloatingBounds(saved, [PRIMARY], PRIMARY)).toEqual(
      defaultFloatingBounds(PRIMARY),
    );
  });

  it("keeps saved bounds visible only on a secondary display", () => {
    const secondary = { x: 1920, y: 0, width: 1440, height: 900 };
    const saved = { x: 2800, y: 500, width: 420, height: 300 };
    expect(resolveFloatingBounds(saved, [PRIMARY, secondary], PRIMARY)).toEqual(saved);
  });

  it("falls back when the visible sliver is too small to grab", () => {
    // Only 50px of the card's width remains on-screen.
    const saved = { x: PRIMARY.width - 50, y: 700, width: 420, height: 300 };
    expect(resolveFloatingBounds(saved, [PRIMARY], PRIMARY)).toEqual(
      defaultFloatingBounds(PRIMARY),
    );
  });

  it("uses the default when nothing was saved", () => {
    expect(resolveFloatingBounds(null, [PRIMARY], PRIMARY)).toEqual(
      defaultFloatingBounds(PRIMARY),
    );
  });
});
