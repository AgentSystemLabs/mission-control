import { describe, expect, it } from "vitest";
import {
  clampVerticalDragDelta,
  verticalDragSettleDelta,
  verticalDragShifts,
  verticalDragTargetIndex,
  type VerticalDragRow,
} from "~/lib/vertical-reorder-drag";

const rows: VerticalDragRow[] = [
  { id: "a", top: 0, height: 100 },
  { id: "b", top: 106, height: 80 },
  { id: "c", top: 192, height: 120 },
];

describe("vertical reorder drag geometry", () => {
  it("keeps a variable-height row inside the list bounds", () => {
    expect(clampVerticalDragDelta(rows, 1, -999)).toBe(-106);
    expect(clampVerticalDragDelta(rows, 1, 999)).toBe(126);
  });

  it("changes targets only after the dragged edge crosses a row midpoint", () => {
    expect(verticalDragTargetIndex(rows, 0, 0)).toBe(0);
    expect(verticalDragTargetIndex(rows, 0, 46)).toBe(0);
    expect(verticalDragTargetIndex(rows, 0, 47)).toBe(1);
    expect(verticalDragTargetIndex(rows, 2, -45)).toBe(2);
    expect(verticalDragTargetIndex(rows, 2, -46)).toBe(1);
  });

  it("slides intervening rows aside by the dragged block size", () => {
    expect(verticalDragShifts(rows, 0, 2, 6)).toEqual({ b: -106, c: -106 });
    expect(verticalDragShifts(rows, 2, 0, 6)).toEqual({ a: 126, b: 126 });
  });

  it("settles exactly into the exposed destination gap", () => {
    expect(verticalDragSettleDelta(rows, 0, 2)).toBe(212);
    expect(verticalDragSettleDelta(rows, 2, 0)).toBe(-192);
    expect(verticalDragSettleDelta(rows, 1, 1)).toBe(0);
  });
});
