import type { ITerminalOptions } from "@xterm/xterm";

const DEFAULT_CURSOR_COLOR = "#ff5a1f";

export function createTerminalOptions({
  cursorColor = DEFAULT_CURSOR_COLOR,
}: {
  cursorColor?: string;
} = {}): ITerminalOptions {
  return {
    fontFamily: 'Geist Mono, ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.4,
    cursorBlink: true,
    theme: {
      background: "#050607",
      foreground: "#e8e6df",
      cursor: cursorColor,
      black: "#0a0b0d",
      brightBlack: "#22262c",
      white: "#e8e6df",
      brightWhite: "#ffffff",
    },
    allowProposedApi: true,
    scrollback: 5000,
  };
}
