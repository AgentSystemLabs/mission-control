import { describe, expect, it } from "vitest";
import { nextProjectPickerHighlight } from "~/lib/project-picker-navigation";

describe("nextProjectPickerHighlight", () => {
  it("reaches a footer action after the project rows", () => {
    expect(nextProjectPickerHighlight(1, 3, "ArrowDown")).toBe(2);
  });

  it("wraps from the first project to the footer action", () => {
    expect(nextProjectPickerHighlight(0, 3, "ArrowUp")).toBe(2);
  });

  it("supports a footer action as the only selectable item", () => {
    expect(nextProjectPickerHighlight(0, 1, "ArrowDown")).toBe(0);
    expect(nextProjectPickerHighlight(0, 1, "ArrowUp")).toBe(0);
  });

  it("supports Home and End", () => {
    expect(nextProjectPickerHighlight(2, 4, "Home")).toBe(0);
    expect(nextProjectPickerHighlight(0, 4, "End")).toBe(3);
  });
});
