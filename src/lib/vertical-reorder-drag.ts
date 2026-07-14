export type VerticalDragRow = {
  id: string;
  top: number;
  height: number;
};

export function clampVerticalDragDelta(
  rows: readonly VerticalDragRow[],
  fromIndex: number,
  delta: number,
): number {
  const dragged = rows[fromIndex];
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!dragged || !first || !last) return 0;
  const min = first.top - dragged.top;
  const max = last.top + last.height - (dragged.top + dragged.height);
  return Math.max(min, Math.min(max, delta));
}

/** Resolve a stable landing index against geometry frozen at drag start. */
export function verticalDragTargetIndex(
  rows: readonly VerticalDragRow[],
  fromIndex: number,
  delta: number,
): number {
  const dragged = rows[fromIndex];
  if (!dragged) return fromIndex;
  const liveTop = dragged.top + delta;
  const liveBottom = liveTop + dragged.height;
  let targetIndex = 0;
  for (let index = 0; index < rows.length; index++) {
    if (index === fromIndex) continue;
    const row = rows[index]!;
    const midpoint = row.top + row.height / 2;
    if (index < fromIndex ? liveTop > midpoint : liveBottom > midpoint) {
      targetIndex++;
    }
  }
  return targetIndex;
}

/** Translate intervening rows to close the origin and expose the target gap. */
export function verticalDragShifts(
  rows: readonly VerticalDragRow[],
  fromIndex: number,
  targetIndex: number,
  gap: number,
): Record<string, number> {
  const dragged = rows[fromIndex];
  if (!dragged) return {};
  const blockSize = dragged.height + gap;
  const shifts: Record<string, number> = {};
  if (targetIndex > fromIndex) {
    for (let index = fromIndex + 1; index <= targetIndex; index++) {
      shifts[rows[index]!.id] = -blockSize;
    }
  } else {
    for (let index = targetIndex; index < fromIndex; index++) {
      shifts[rows[index]!.id] = blockSize;
    }
  }
  return shifts;
}

/** Exact transform that places the dragged row into its exposed landing gap. */
export function verticalDragSettleDelta(
  rows: readonly VerticalDragRow[],
  fromIndex: number,
  targetIndex: number,
): number {
  const dragged = rows[fromIndex];
  const target = rows[targetIndex];
  if (!dragged || !target || targetIndex === fromIndex) return 0;
  return targetIndex > fromIndex
    ? target.top + target.height - (dragged.top + dragged.height)
    : target.top - dragged.top;
}
