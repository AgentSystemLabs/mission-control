import type { CSSProperties, ReactNode, RefObject } from "react";

/**
 * Presentational shell for an xterm.js terminal. Pairs with `useXtermPty`,
 * which owns the lifecycle and ResizeObserver — this component only
 * renders the absolutely-positioned host div (so xterm can size itself
 * against the parent's content box) and a friendly fallback when the
 * Electron preload bridge is missing.
 */
export function XtermSurface({
  containerRef,
  bridgeMissing,
  bridgeMissingMessage,
  background = "var(--terminal-bg)",
  style,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  bridgeMissing: boolean;
  /** Override the default "Terminals require the Electron runtime." copy. */
  bridgeMissingMessage?: ReactNode;
  background?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        flex: 1,
        position: "relative",
        background,
        ...style,
      }}
    >
      {bridgeMissing ? (
        <div
          style={{
            padding: 16,
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          {bridgeMissingMessage ?? "Terminals require the Electron runtime."}
        </div>
      ) : (
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      )}
    </div>
  );
}
