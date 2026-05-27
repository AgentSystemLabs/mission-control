import { afterEach, describe, expect, it, vi } from "vitest";
import { isMacPlatform, openTerminalLink, terminalLinkRequiresModifier } from "../terminal-links";

describe("terminal links", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires Cmd on macOS", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Macintosh" });
    expect(isMacPlatform()).toBe(true);
    expect(terminalLinkRequiresModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(terminalLinkRequiresModifier({ metaKey: false, ctrlKey: true })).toBe(false);
    expect(terminalLinkRequiresModifier({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("requires Ctrl on non-macOS", () => {
    vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows NT 10.0" });
    expect(isMacPlatform()).toBe(false);
    expect(terminalLinkRequiresModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(terminalLinkRequiresModifier({ metaKey: true, ctrlKey: false })).toBe(false);
    expect(terminalLinkRequiresModifier({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("opens links through electron when available", () => {
    const openExternal = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("window", { electronAPI: { openExternal } });
    openTerminalLink("https://example.com/docs");
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("falls back to an anchor click in the browser", () => {
    const click = vi.fn();
    const anchor = { href: "", target: "", rel: "", click };
    const createElement = vi.fn().mockReturnValue(anchor);
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("window", { electronAPI: undefined });
    openTerminalLink("https://example.com/docs");
    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor.href).toBe("https://example.com/docs");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    expect(click).toHaveBeenCalled();
  });
});
