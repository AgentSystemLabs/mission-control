import type { ReactNode } from "react";

/**
 * The boxed inline form error shown at the bottom of dialogs — a mono,
 * status-failed-tinted panel. Renders nothing when `error` is falsy, so callers
 * can pass a possibly-empty message straight through.
 */
export function FormErrorBox({ error }: { error: ReactNode }) {
  if (!error) return null;
  return (
    <div
      style={{
        padding: "8px 12px",
        border: "1px solid var(--status-failed)",
        background: "color-mix(in oklch, var(--status-failed) 12%, transparent)",
        borderRadius: 7,
        color: "var(--status-failed)",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
      }}
    >
      {error}
    </div>
  );
}
