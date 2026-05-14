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

export function keyEventToTerminalInput(e: KeyboardEvent): string | null {
  const mapped = mapTerminalKey(e);
  if (mapped !== null) return mapped;

  if (e.metaKey) return null;
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.length === 1) {
    const code = e.key.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  }

  switch (e.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Delete":
      return "\x1b[3~";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
  }

  if (!e.ctrlKey && !e.altKey && e.key.length === 1) return e.key;
  return null;
}

function isShiftEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
}
