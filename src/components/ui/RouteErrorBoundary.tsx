import { Btn } from "./Btn";
import { CardFrame } from "./CardFrame";
import { Icon } from "./Icon";
import { ApiError } from "~/lib/api";

const GENERIC_ROUTE_ERROR = "Something went wrong loading this view.";

/**
 * Friendly error UI shown by route-level `errorComponent` and the router's
 * `defaultErrorComponent` so a loader rejection never leaves the user staring
 * at a blank screen. Visuals intentionally echo the TopBar / CardFrame
 * conventions (dim mono text, subtle border, single accent action).
 */
export function RouteErrorBoundary({
  error,
  reset,
}: {
  error: unknown;
  reset?: () => void;
}) {
  const message = error instanceof ApiError ? error.message : GENERIC_ROUTE_ERROR;

  return (
    <div
      role="alert"
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        minHeight: 0,
        overflow: "auto",
      }}
      className="dot-grid-bg"
    >
      <CardFrame
        style={{
          width: "100%",
          maxWidth: 520,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "var(--surface-2)",
            color: "var(--status-failed)",
          }}
        >
          <Icon name="x" size={18} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            Something went wrong
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--text-dim)",
              fontFamily: "var(--mono)",
              lineHeight: 1.5,
              wordBreak: "break-word",
            }}
          >
            {message}
          </div>
        </div>
        {reset && (
          <Btn variant="primary" icon="refresh" onClick={() => reset()}>
            Retry
          </Btn>
        )}
      </CardFrame>
    </div>
  );
}
