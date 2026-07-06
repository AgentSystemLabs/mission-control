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
        <button
          type="button"
          onClick={onHome}
          aria-label="Mission Control home"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            color: "inherit",
            pointerEvents: "auto",
            ["WebkitAppRegion" as any]: "no-drag",
          }}
        >
          <img
            src="/images/robot.png"
            alt="AgentSystem.dev"
            width={22}
            height={22}
            style={{ borderRadius: 5, display: "block" }}
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>Mission</span>
            <span
              aria-hidden
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "var(--accent)",
                boxShadow: "0 0 6px var(--accent)",
              }}
            />
            <span style={{ color: "var(--accent)" }}>Control</span>
          </span>
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
            aria-hidden
            style={{
              width: 1,
              height: 18,
              background: "var(--border)",
              margin: "0 4px",
            }}
          />
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
