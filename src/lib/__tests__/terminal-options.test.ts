import { describe, expect, it } from "vitest";
import {
  createTerminalOptions,
  createTerminalTheme,
  getTerminalColorScheme,
} from "../terminal-options";

describe("terminal options", () => {
  it("defaults to the dark terminal theme", () => {
    expect(createTerminalOptions()).toMatchObject({
      lineHeight: 1,
      fontSize: 12,
    });
    expect(createTerminalOptions().theme).toMatchObject({
      background: "#050607",
      foreground: "#e8e6df",
      cursor: "#ff5a1f",
    });
  });

  it("uses a readable light terminal theme", () => {
    expect(createTerminalTheme({ colorScheme: "light" })).toMatchObject({
      background: "#ffffff",
      foreground: "#1a1a1a",
      black: "#1a1a1a",
      white: "#f1f0eb",
    });
  });

  it("keeps agent-specific cursor colors across themes", () => {
    expect(createTerminalTheme({ colorScheme: "light", cursorColor: "#2e90fa" }).cursor).toBe(
      "#2e90fa"
    );
  });

  it("falls back to dark outside the browser", () => {
    expect(getTerminalColorScheme()).toBe("dark");
  });
});
