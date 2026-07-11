import type { CSSProperties } from "react";

// Animated glyph for the grid-layout control. Six cells morph between two
// arrangements of the same area — two rows of three, and three rows of two —
// which is exactly what the control does to the real grid (pick how many
// sessions each row holds), and keeps it visually distinct from the grid/list
// view toggle's 2x2. React swaps the coordinate set when the menu is open;
// hovering the button previews the same morph via CSS geometry overrides
// (see .mc-gridlayout-icon in styles.css). Cell indexes follow reading order
// in both states, so each rect visibly reflows like a session card would.

type Rect = { x: number; y: number; width: number; height: number };

// Resting state: two rows of three cells.
const THREE_PER_ROW: Rect[] = [
  { x: 2, y: 2, width: 3.4, height: 5.5 },
  { x: 6.3, y: 2, width: 3.4, height: 5.5 },
  { x: 10.6, y: 2, width: 3.4, height: 5.5 },
  { x: 2, y: 8.5, width: 3.4, height: 5.5 },
  { x: 6.3, y: 8.5, width: 3.4, height: 5.5 },
  { x: 10.6, y: 8.5, width: 3.4, height: 5.5 },
];

// Open state: the same six cells reflowed into three rows of two.
const TWO_PER_ROW: Rect[] = [
  { x: 2, y: 2, width: 5.5, height: 3.4 },
  { x: 8.5, y: 2, width: 5.5, height: 3.4 },
  { x: 2, y: 6.3, width: 5.5, height: 3.4 },
  { x: 8.5, y: 6.3, width: 5.5, height: 3.4 },
  { x: 2, y: 10.6, width: 5.5, height: 3.4 },
  { x: 8.5, y: 10.6, width: 5.5, height: 3.4 },
];

export function GridLayoutIcon({
  active,
  size = 15,
  style,
}: {
  /** True while the layout menu/popup is open — holds the reflowed state. */
  active: boolean;
  size?: number;
  style?: CSSProperties;
}) {
  const rects = active ? TWO_PER_ROW : THREE_PER_ROW;
  return (
    <svg
      className="mc-gridlayout-icon"
      data-active={active ? "true" : undefined}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{ display: "block", flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} rx={1} />
      ))}
    </svg>
  );
}
