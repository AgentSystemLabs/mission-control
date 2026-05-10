import type { ReactNode } from "react";
import { Btn } from "./Btn";
import { Icon } from "./Icon";

export type Crumb = { label: string; onClick?: () => void; node?: ReactNode };

export function TopBar({
  crumbs,
  right,
  onHome,
  leading,
}: {
  crumbs?: Crumb[];
  right?: ReactNode;
  onHome?: () => void;
  leading?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 48,
        padding: "0 20px 0 24px",
        background: "transparent",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
        ["WebkitAppRegion" as any]: "drag",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          ["WebkitAppRegion" as any]: "no-drag",
        }}
      >
        <Btn
          variant="gray-frame"
          onClick={onHome}
          aria-label="Mission Control home"
          style={{ ["WebkitAppRegion" as any]: "no-drag" }}
        >
          <img
            src="/robot.png"
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
          {leading && (
            <span
              aria-hidden
              style={{
                width: 1,
                height: 18,
                background: "var(--border-strong)",
              }}
            />
          )}
          {leading}
        </Btn>
        {crumbs && crumbs.length > 0 && (
          <>
            <Icon name="chevron-right" size={11} style={{ color: "var(--text-faint)" }} />
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                {i > 0 && (
                  <Icon name="chevron-right" size={11} style={{ color: "var(--text-faint)" }} />
                )}
                {c.node ? (
                  c.node
                ) : (
                  <span
                    onClick={c.onClick}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: i === crumbs.length - 1 ? "var(--text)" : "var(--text-dim)",
                      cursor: c.onClick ? "pointer" : "default",
                    }}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          ["WebkitAppRegion" as any]: "no-drag",
        }}
      >
        {right}
      </div>
    </div>
  );
}
