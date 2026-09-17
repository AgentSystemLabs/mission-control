export type ProjectPickerNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/**
 * Move through the project picker's single selectable sequence. The count can
 * include non-project actions such as the group-scoped "All projects" footer.
 */
export function nextProjectPickerHighlight(
  current: number,
  count: number,
  key: ProjectPickerNavigationKey,
): number {
  if (count <= 0) return 0;
  const clamped = Math.max(0, Math.min(current, count - 1));
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (clamped + 1) % count;
  return (clamped - 1 + count) % count;
}
