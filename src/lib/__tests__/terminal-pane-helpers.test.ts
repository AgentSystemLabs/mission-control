import { describe, expect, it, vi } from "vitest";
import {
  attachTerminalKeyHandler,
  stripTerminalSelectionFormatting,
} from "../terminal-pane-helpers";

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    type: "keydown",
    key: "",
    code: "",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function createHarness(opts: { selection?: string } = {}) {
  let handler: ((e: KeyboardEvent) => boolean) | null = null;
  let selection = opts.selection ?? "";
  const term = {
    focus: vi.fn(),
    attachCustomKeyEventHandler: vi.fn((next: (e: KeyboardEvent) => boolean) => {
      handler = next;
    }),
    hasSelection: vi.fn(() => selection.length > 0),
    getSelection: vi.fn(() => selection),
    clearSelection: vi.fn(() => {
      selection = "";
    }),
    paste: vi.fn(),
  };
  const electron = {
    clipboard: {
      readText: vi.fn(async () => "line1\nline2"),
      writeText: vi.fn(async () => ({ ok: true as const })),
    },
    pty: {
      write: vi.fn(),
    },
  };

  attachTerminalKeyHandler({
    term,
    electron: electron as never,
    getActivePtyId: () => "pty-1",
  });
  if (!handler) throw new Error("handler was not attached");
  return { term, electron, handler: handler as (e: KeyboardEvent) => boolean };
}

describe("stripTerminalSelectionFormatting", () => {
  it("removes ANSI escape sequences from copied terminal selection", () => {
    expect(stripTerminalSelectionFormatting("\x1b[31mred\x1b[0m plain")).toBe("red plain");
  });
});

describe("attachTerminalKeyHandler clipboard handling", () => {
  it("copies plain Ctrl+C only when the terminal has a selection", async () => {
    const { term, electron, handler } = createHarness({ selection: "\x1b[32mhello\x1b[0m" });
    const event = keyEvent({ ctrlKey: true, code: "KeyC", key: "c" });

    expect(handler(event)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    await Promise.resolve();

    expect(electron.clipboard.writeText).toHaveBeenCalledWith("hello");
    expect(term.clearSelection).toHaveBeenCalledOnce();
    expect(electron.pty.write).not.toHaveBeenCalled();
  });

  it("lets plain Ctrl+C pass through as SIGINT when there is no selection", () => {
    const { electron, handler } = createHarness();
    const event = keyEvent({ ctrlKey: true, code: "KeyC", key: "c" });

    expect(handler(event)).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(electron.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("pastes plain Ctrl+V through xterm instead of writing directly to the PTY", async () => {
    const { term, electron, handler } = createHarness();
    const event = keyEvent({ ctrlKey: true, code: "KeyV", key: "v" });

    expect(handler(event)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    await Promise.resolve();

    expect(electron.clipboard.readText).toHaveBeenCalledOnce();
    expect(term.paste).toHaveBeenCalledWith("line1\nline2");
    expect(electron.pty.write).not.toHaveBeenCalled();
  });

  it("keeps Ctrl+Shift+V on the same paste path", async () => {
    const { term, electron, handler } = createHarness();
    const event = keyEvent({ ctrlKey: true, shiftKey: true, code: "KeyV", key: "V" });

    expect(handler(event)).toBe(false);
    await Promise.resolve();

    expect(electron.clipboard.readText).toHaveBeenCalledOnce();
    expect(term.paste).toHaveBeenCalledWith("line1\nline2");
  });
});
