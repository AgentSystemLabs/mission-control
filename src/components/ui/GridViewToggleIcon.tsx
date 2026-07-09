import type { CSSProperties } from "react";

// A single animated icon for the grid/list view toggle. Instead of swapping two
// static icons, the four cells physically morph: in list view the button offers
// the grid destination (a 2x2 of squares); in grid view the two left squares
// shrink into bullets and the two right squares stretch into rows — so the click
// reads as "the view is changing", not just "a different button". CSS transitions
// on the SVG geometry attributes (see .mc-viewtoggle-icon in styles.css) animate
// between the two coordinate sets on every toggle.

type Rect = { x: number; y: number; width: number; height: number; rx: number };

// Destination = grid: a clean 2x2 of rounded squares.
const GRID: [Rect, Rect, Rect, Rect] = [
  { x: 2, y: 2, width: 5, height: 5, rx: 1.2 },
  { x: 9, y: 2, width: 5, height: 5, rx: 1.2 },
  { x: 2, y: 9, width: 5, height: 5, rx: 1.2 },
  { x: 9, y: 9, width: 5, height: 5, rx: 1.2 },
];

// Destination = list: bullet + row, twice. The left column collapses to squares,
// the right column stretches into lines.
const LIST: [Rect, Rect, Rect, Rect] = [
  { x: 2, y: 3, width: 3, height: 3, rx: 1 },
  { x: 6.5, y: 3.5, width: 7.5, height: 2, rx: 1 },
  { x: 2, y: 10, width: 3, height: 3, rx: 1 },
  { x: 6.5, y: 10.5, width: 7.5, height: 2, rx: 1 },
];

export function GridViewToggleIcon({
  gridView,
  size = 13,
  style,
}: {
  // When grid view is active the button switches to list, so it shows the list
  // destination; otherwise it shows the grid destination.
  gridView: boolean;
  size?: number;
  style?: CSSProperties;
}) {
  const rects = gridView ? LIST : GRID;
  return (
    <svg
      className="mc-viewtoggle-icon"
      data-target={gridView ? "list" : "grid"}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{ display: "block", flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} rx={r.rx} />
      ))}
    </svg>
  );
}
