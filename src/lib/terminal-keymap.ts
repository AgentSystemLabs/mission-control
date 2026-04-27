// Translates keyboard shortcuts that xterm.js doesn't natively forward
// (Shift+Enter, Cmd+arrow line-edits, Option+arrow word-movement) into the
// readline/Claude-Code escape sequences the underlying PTY expects.
// Returns the bytes to write, or null to let xterm handle the event normally.
export function mapTerminalKey(e: KeyboardEvent): string | null {
  if (e.type !== "keydown") return null;

  if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
