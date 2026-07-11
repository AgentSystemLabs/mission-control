import { describe, expect, it } from "vitest";
import { isXtermWithinScope } from "~/lib/terminal-pane-helpers";

/**
 * Minimal `Element`-like stub whose `closest(sel)` walks a fixed ancestor chain.
 * `chain` lists the CSS-ish tokens present on the element and each ancestor
 * (attribute selectors like `[data-grid-cell]`, or `.xterm`); `closest` returns
 * a truthy match when any of them appears in the chain. Lets us exercise the
 * scope-matching logic in the node env without a real DOM.
 */
function fakeElement(chain: string[]): Element {
  return {
    closest(selector: string) {
      return chain.includes(selector) ? (this as unknown as Element) : null;
    },
  } as unknown as Element;
}

describe("isXtermWithinScope", () => {
  it("matches an xterm nested inside the scoped container (grid cell)", () => {
    const el = fakeElement([".xterm", "[data-grid-cell]"]);
    expect(isXtermWithinScope(el, "[data-grid-cell]")).toBe(true);
  });

  it("rejects an xterm that is not inside the scoped container", () => {
    const el = fakeElement([".xterm"]);
    expect(isXtermWithinScope(el, "[data-grid-cell]")).toBe(false);
  });

  it("rejects focus inside the scoped container but outside any xterm surface", () => {
    const el = fakeElement(["[data-grid-cell]"]);
    expect(isXtermWithinScope(el, "[data-grid-cell]")).toBe(false);
  });

  it("rejects a null active element", () => {
    expect(isXtermWithinScope(null, "[data-grid-cell]")).toBe(false);
  });

  it("keeps the session panel and user panel scopes distinct", () => {
    const gridEl = fakeElement([".xterm", "[data-grid-cell]"]);
    expect(isXtermWithinScope(gridEl, "[data-session-terminal-panel]")).toBe(false);
    expect(isXtermWithinScope(gridEl, "[data-user-terminal-panel]")).toBe(false);
  });

  it("matches an xterm nested inside the focus-mode terminal, so Cmd/Ctrl +/- zooms the session", () => {
    const el = fakeElement([".xterm", "[data-focus-terminal-panel]"]);
    expect(isXtermWithinScope(el, "[data-focus-terminal-panel]")).toBe(true);
    // stays distinct from the other terminal scopes
    expect(isXtermWithinScope(el, "[data-grid-cell]")).toBe(false);
  });
});
