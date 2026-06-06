import { describe, expect, it, vi } from "vitest";
import {
  attachTerminalKeyHandler,
  stripTerminalSelectionFormatting,
  terminalExitTaskStatus,
  wireTerminalFileDrop,
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

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    terminalImages: {
      saveDropped: vi.fn(async () => ({ path: "/tmp/dropped.png" })),
      saveClipboard: vi.fn<() => Promise<{ path: string } | { error: string } | null>>(
        async () => null,
      ),
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

describe("terminalExitTaskStatus", () => {
  it("marks a clean agent exit as finished", () => {
    expect(terminalExitTaskStatus(0)).toBe("finished");
  });

  it("marks failed or unknown exits as terminated", () => {
    expect(terminalExitTaskStatus(1)).toBe("terminated");
    expect(terminalExitTaskStatus(undefined)).toBe("terminated");
  });
});

describe("attachTerminalKeyHandler clipboard handling", () => {
  it("copies plain Ctrl+C only when the terminal has a selection", async () => {
    const { term, electron, handler } = createHarness({ selection: "\x1b[32mhello\x1b[0m" });
    const event = keyEvent({ ctrlKey: true, code: "KeyC", key: "c" });

    expect(handler(event)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    await flushPromises();

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
    await flushPromises();

    expect(electron.clipboard.readText).toHaveBeenCalledOnce();
    expect(term.paste).toHaveBeenCalledWith("line1\nline2");
    expect(electron.pty.write).not.toHaveBeenCalled();
  });

  it("keeps Ctrl+Shift+V on the same paste path", async () => {
    const { term, electron, handler } = createHarness();
    const event = keyEvent({ ctrlKey: true, shiftKey: true, code: "KeyV", key: "V" });

    expect(handler(event)).toBe(false);
    await flushPromises();

    expect(electron.clipboard.readText).toHaveBeenCalledOnce();
    expect(term.paste).toHaveBeenCalledWith("line1\nline2");
  });

  it("pastes a saved clipboard image path when Ctrl+V has no text", async () => {
    const { term, electron, handler } = createHarness();
    electron.clipboard.readText.mockResolvedValueOnce("");
    electron.terminalImages.saveClipboard.mockResolvedValueOnce({
      path: "/tmp/Mission Control/screenshot.png",
    });
    const event = keyEvent({ ctrlKey: true, code: "KeyV", key: "v" });

    expect(handler(event)).toBe(false);
    await flushPromises();

    expect(electron.terminalImages.saveClipboard).toHaveBeenCalledOnce();
    expect(term.paste).toHaveBeenCalledWith('"/tmp/Mission Control/screenshot.png" ');
  });
});

describe("wireTerminalFileDrop", () => {
  it("saves pathless dropped image files and writes the saved path to the PTY", async () => {
    const listeners = new Map<string, EventListener>();
    const host = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
    };
    const electron = {
      getPathForFile: vi.fn(() => ""),
      terminalImages: {
        saveDropped: vi.fn(async () => ({ path: "/tmp/dropped-screenshot.png" })),
      },
      pty: {
        write: vi.fn(),
      },
    };
    const onFocus = vi.fn();

    wireTerminalFileDrop({
      host: host as never,
      electron: electron as never,
      getActivePtyId: () => "pty-1",
      onFocus,
    });

    const file = new File([new Uint8Array([1, 2, 3])], "screenshot.png", {
      type: "image/png",
    });
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["Files"],
        files: [file],
        getData: vi.fn(() => ""),
      },
    } as unknown as DragEvent;

    listeners.get("drop")?.(event);
    await flushPromises();

    expect(electron.getPathForFile).toHaveBeenCalledWith(file);
    expect(electron.terminalImages.saveDropped).toHaveBeenCalledWith({
      name: "screenshot.png",
      mimeType: "image/png",
      data: expect.any(ArrayBuffer),
    });
    expect(electron.pty.write).toHaveBeenCalledWith("pty-1", "/tmp/dropped-screenshot.png ");
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it("does not read oversized pathless image drops into memory", async () => {
    const listeners = new Map<string, EventListener>();
    const host = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
    };
    const electron = {
      getPathForFile: vi.fn(() => ""),
      terminalImages: {
        saveDropped: vi.fn(async () => ({ path: "/tmp/dropped-screenshot.png" })),
      },
      pty: {
        write: vi.fn(),
      },
    };
    wireTerminalFileDrop({
      host: host as never,
      electron: electron as never,
      getActivePtyId: () => "pty-1",
      onFocus: vi.fn(),
    });

    const file = {
      name: "huge.png",
      type: "image/png",
      size: 20 * 1024 * 1024 + 1,
      arrayBuffer: vi.fn(),
    } as unknown as File;
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["Files"],
        files: [file],
        getData: vi.fn(() => ""),
      },
    } as unknown as DragEvent;

    listeners.get("drop")?.(event);
    await flushPromises();

    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(electron.terminalImages.saveDropped).not.toHaveBeenCalled();
    expect(electron.pty.write).not.toHaveBeenCalled();
  });
});
