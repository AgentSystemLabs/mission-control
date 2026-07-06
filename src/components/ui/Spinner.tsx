import type { CSSProperties } from "react";
import { Icon } from "./Icon";

/**
 * A spinning `refresh` glyph — the inline loading indicator used across ship,
 * PR, sandbox, and markdown-refine flows. Relies on the global `spin` keyframe.
 * `color`/`aria-hidden`/`style` are omitted from the DOM when not passed, so
 * each call renders exactly what its former hand-rolled span did.
 */
export function Spinner({
  size = 12,
  color,
  style,
  "aria-hidden": ariaHidden,
}: {
  size?: number;
  color?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean;
}) {
  return (
    <span
      aria-hidden={ariaHidden}
      style={{
        display: "inline-flex",
        ...(color ? { color } : {}),
        animation: "spin 0.8s linear infinite",
        ...style,
      }}
    >
      <Icon name="refresh" size={size} />
    </span>
  );
}
