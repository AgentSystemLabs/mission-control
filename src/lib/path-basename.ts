/** Last segment of a filesystem path (either separator), ignoring trailing separators. */
export function pathBasename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || "";
}
