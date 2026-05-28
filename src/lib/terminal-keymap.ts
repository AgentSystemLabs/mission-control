// Translates keyboard shortcuts that xterm.js doesn't natively forward
// (Shift+Enter, Cmd+arrow line-edits, Option+arrow word-movement) into the
// readline/Claude-Code escape sequences the underlying PTY expects.
// Returns the bytes to write, or null to let xterm handle the event normally.
export function mapTerminalKey(e: KeyboardEvent): string | null {
  if (e.type !== "keydown") return null;

  if (isShiftEnter(e)) {
    return "\x1b\r";
  }

  if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "ArrowLeft") return "\x01";
    if (e.key === "ArrowRight") return "\x05";
    if (e.key === "Backspace") return "\x15";
  }

  if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    if (e.key === "ArrowLeft") return "\x1bb";
    if (e.key === "ArrowRight") return "\x1bf";
  }

  return null;
}

// xterm.js calls the custom handler for keydown, keypress, and keyup. We write
// custom bytes on keydown, then suppress the follow-up keypress so Chromium
// cannot turn Shift+Enter into a plain Enter byte through the textarea path.
export function shouldSuppressTerminalKey(e: KeyboardEvent): boolean {
  return e.type === "keypress" && isShiftEnter(e);
}

export type TerminalClipboardAction = "copy" | "paste";

/**
 * Recognize the terminal copy/paste chords. In a terminal, plain Ctrl+C/Ctrl+V
 * are control codes (SIGINT / quoted-insert) the PTY needs, so they can't double
 * as copy/paste — hence the cross-platform convention used by VS Code, GNOME
 * Terminal, and Windows Terminal: Ctrl+Shift+C to copy, Ctrl+Shift+V to paste,
 * with Ctrl+Insert / Shift+Insert as the classic aliases.
 *
 * macOS copy/paste stays on Cmd+C/Cmd+V (driven by the OS Edit menu, untouched
 * here): Cmd sets metaKey, which we explicitly exclude, and these chords never
 * collide with it — so this map is correct on every platform and needs no
 * platform branch.
 *
 * Matches on every event type (keydown/keypress/keyup) so the caller can both
 * act on keydown and swallow the follow-up events, keeping xterm from turning
 * the chord into a stray control byte.
 */
export function terminalClipboardAction(e: KeyboardEvent): TerminalClipboardAction | null {
  if (e.altKey || e.metaKey) return null;

  if (e.ctrlKey && e.shiftKey) {
    if (e.code === "KeyC" || e.key === "c" || e.key === "C") return "copy";
    if (e.code === "KeyV" || e.key === "v" || e.key === "V") return "paste";
    return null;
  }

  if (e.code === "Insert" || e.key === "Insert") {
    if (e.ctrlKey && !e.shiftKey) return "copy";
    if (e.shiftKey && !e.ctrlKey) return "paste";
  }

  return null;
}

function isShiftEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
}
