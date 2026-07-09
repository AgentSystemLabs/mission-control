import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type Crumb = { label: string; onClick?: () => void; node?: ReactNode };

export function TopBar({
  crumbs,
  right,
  onHome,
  leading,
  centerActions,
  leadingInset,
  contentTopInset = 0,
  dragRegion = true,
}: {
  crumbs?: Crumb[];
  right?: ReactNode;
  onHome?: () => void;
  leading?: ReactNode;
  centerActions?: ReactNode;
  leadingInset?: number;
  contentTopInset?: number;
  dragRegion?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 48 + contentTopInset,
        // Vertical padding stays symmetric so `align-items: center` truly
        // centers the wordmark + dropdown in the bar. The extra height from
        // contentTopInset (minimal/noir/ember) just makes a taller bar; it must
        // NOT be applied as top-only padding, which pushed content below centre.
        padding: `0 20px 0 ${leadingInset ?? 24}px`,
        background: "transparent",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
        pointerEvents: "auto",
        ["WebkitAppRegion" as any]: dragRegion ? "drag" : "no-drag",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
        }}
      >
        {/* App identity recedes to a logo-only home button so the project
         * cockpit (picker → scope → run → branch/ship) is the bar's centre of
         * gravity. The wordmark still shows on the home/launch screen. */}
        <button
          type="button"
          onClick={onHome}
          aria-label="Mission Control home"
          title="Mission Control — home"
          className="mc-topbar-home"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            // Fixed square (comfortable hit area) with the logo centered.
            // No padding + negative-margin trick — negative margins shift a
            // flex item off-centre, which is what threw the logo off.
            width: 34,
            height: 34,
            flexShrink: 0,
            border: "none",
            padding: 0,
            borderRadius: 8,
            cursor: "pointer",
            color: "inherit",
            pointerEvents: "auto",
            ["WebkitAppRegion" as any]: "no-drag",
          }}
        >
          <img
            src="/images/robot.png"
            alt="Mission Control"
            width={22}
            height={22}
            style={{ borderRadius: 5, display: "block" }}
          />
        </button>
        {leading && (
          <>
            <span
              aria-hidden
              style={{
                width: 1,
                height: 18,
                background: "var(--border-strong)",
              }}
            />
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                pointerEvents: "auto",
                ["WebkitAppRegion" as any]: "no-drag",
              }}
            >
              {leading}
            </span>
          </>
        )}
        {crumbs && crumbs.length > 0 && (
          <>
            <Icon name="chevron-right" size={11} style={{ color: "var(--text-faint)" }} />
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                {i > 0 && (
                  <Icon name="chevron-right" size={11} style={{ color: "var(--text-faint)" }} />
                )}
                {c.node ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      pointerEvents: "auto",
                      ["WebkitAppRegion" as any]: "no-drag",
                    }}
                  >
                    {c.node}
                  </span>
                ) : (
                  <span
                    onClick={c.onClick}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: i === crumbs.length - 1 ? "var(--text)" : "var(--text-dim)",
                      cursor: c.onClick ? "pointer" : "default",
                      pointerEvents: c.onClick ? "auto" : undefined,
                      ["WebkitAppRegion" as any]: c.onClick ? "no-drag" : undefined,
                    }}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </>
        )}
        {centerActions && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              pointerEvents: "auto",
              ["WebkitAppRegion" as any]: "no-drag",
            }}
          >
            {centerActions}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          pointerEvents: "auto",
          ["WebkitAppRegion" as any]: "no-drag",
        }}
      >
        {right}
      </div>
    </div>
  );
}
