import { describe, expect, it } from "vitest";
import { parseResponse, resolveTitleInvocation } from "../title-generator";

describe("title-generator parseResponse", () => {
  it("parses the canonical TITLE:/ICON: two-line format", () => {
    const raw = "TITLE: Refactor auth middleware\nICON: shield-check";
    expect(parseResponse(raw)).toEqual({
      title: "Refactor auth middleware",
      icon: "shield-check",
    });
  });

  it("picks the LAST TITLE/ICON pair when the model echoes the examples back", () => {
    const raw = [
      "TITLE: Switch auth from cookies to JWT",
      "ICON: shield-check",
      "TITLE: Add dark mode toggle",
      "ICON: palette",
    ].join("\n");
    expect(parseResponse(raw)).toEqual({
      title: "Add dark mode toggle",
      icon: "palette",
    });
  });

  it("accepts `title=` / `icon=` as a synonym for `TITLE:` / `ICON:`", () => {
    const raw = "title = Add dark mode toggle\nicon = palette";
    expect(parseResponse(raw)).toEqual({
      title: "Add dark mode toggle",
      icon: "palette",
    });
  });

  it("falls back to JSON when the model emits JSON anyway", () => {
    const raw = '{"title":"Wire push hotkey","icon":"upload"}';
    expect(parseResponse(raw)).toEqual({
      title: "Wire push hotkey",
      icon: "upload",
    });
  });

  it("picks the right-most JSON block when the CLI prints preamble", () => {
    const raw = [
      "[2026-05-15T01:00:00] connecting…",
      "{diagnostic: 'noise', token: 42}",
      '{"title":"Wire push hotkey","icon":"upload"}',
    ].join("\n");
    expect(parseResponse(raw)).toEqual({
      title: "Wire push hotkey",
      icon: "upload",
    });
  });

  it("drops an icon name not in the whitelist", () => {
    const raw = "TITLE: Build login page\nICON: unicorn-galaxy";
    expect(parseResponse(raw)).toEqual({ title: "Build login page", icon: null });
  });

  it("trims trailing punctuation and surrounding quotes from the title", () => {
    const raw = 'TITLE: "Set up CI pipeline."\nICON: check';
    expect(parseResponse(raw)).toEqual({ title: "Set up CI pipeline", icon: "check" });
  });

  it("strips terminal color escape sequences from generated titles", () => {
    const raw = "TITLE: \x1b]11;rgb:0505/0606/0707\x07Make quick patch\nICON: bug";
    expect(parseResponse(raw)).toEqual({ title: "Make quick patch", icon: "bug" });
  });

  it("strips orphaned terminal rgb responses from generated titles", () => {
    const raw = "TITLE: 1;rgb:0505/0606/0707make a quick patch\nICON: bug";
    expect(parseResponse(raw)).toEqual({ title: "make a quick patch", icon: "bug" });
  });

  it("strips terminal color responses before parsing JSON fallback output", () => {
    const raw = '{"title":"\x1b]11;rgb:0505/0606/0707\x07Make quick patch","icon":"bug"}';
    expect(parseResponse(raw)).toEqual({ title: "Make quick patch", icon: "bug" });
  });

  it("falls back to last-line text when no recognizable format is present", () => {
    const raw = "Some preamble\nLast line title";
    expect(parseResponse(raw)).toEqual({ title: "Last line title", icon: null });
  });
});

describe("resolveTitleInvocation", () => {
  it("uses claude print mode for cursor-cli titles instead of cursor-agent", () => {
    const invocation = resolveTitleInvocation("cursor-cli", "fix login bug");
    expect(invocation).toEqual({
      cmd: "claude",
      args: ["-p", expect.stringContaining("fix login bug")],
    });
    expect(invocation?.cmd).not.toBe("cursor-agent");
  });

  it("keeps agent-native print mode for non-cursor agents", () => {
    expect(resolveTitleInvocation("codex", "fix login bug")).toEqual({
      cmd: "codex",
      args: ["exec", expect.stringContaining("fix login bug")],
    });
  });
});
