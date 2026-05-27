import { normalizePtySize } from "~/shared/pty-size";

type TerminalSizeSource = {
  cols: number;
  rows: number;
};

export function resizePtyToTerminal<T>(
  term: TerminalSizeSource,
  resize: (cols: number, rows: number) => T,
): T {
  const ptySize = normalizePtySize({ cols: term.cols, rows: term.rows });
  return resize(ptySize.cols, ptySize.rows);
}
