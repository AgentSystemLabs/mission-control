const DEFAULT_TERMINAL_NAME_RE = /^Terminal (\d+)$/;

/**
 * Pick the lowest unused "Terminal N" name given the existing terminal names in
 * a scope. Callers gather whichever names apply (per-scope, per-project, …) and
 * pass them in; this owns the numbering.
 */
export function nextTerminalName(usedNames: Iterable<string>): string {
  const used = new Set<number>();
  for (const name of usedNames) {
    const match = DEFAULT_TERMINAL_NAME_RE.exec(name);
    if (match) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `Terminal ${n}`;
}
