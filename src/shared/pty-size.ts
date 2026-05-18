export const MIN_PTY_COLS = 10;
export const MIN_PTY_ROWS = 10;
export const MAX_PTY_COLS = 500;
export const MAX_PTY_ROWS = 500;
export const DEFAULT_PTY_COLS = 100;
export const DEFAULT_PTY_ROWS = 30;

type PtySizeInput = {
  cols?: number;
  rows?: number;
};

function normalizePtyDimension(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizePtySize(input: PtySizeInput): { cols: number; rows: number } {
  return {
    cols: normalizePtyDimension(input.cols, MIN_PTY_COLS, MAX_PTY_COLS, DEFAULT_PTY_COLS),
    rows: normalizePtyDimension(input.rows, MIN_PTY_ROWS, MAX_PTY_ROWS, DEFAULT_PTY_ROWS),
  };
}
