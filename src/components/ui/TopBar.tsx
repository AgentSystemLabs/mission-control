import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type Crumb = { label: string; onClick?: () => void; node?: ReactNode };

export function TopBar({
  crumbs,
  right,
  onHome,
}: {
  crumbs?: Crumb[];
  right?: ReactNode;
  onHome?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 48,
        padding: "0 20px",
        background: "var(--surface-0)",
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
          paddingLeft: 60, // room for macOS traffic lights
          ["WebkitAppRegion" as any]: "no-drag",
        }}
      >
        <div onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0a0b0d",
              fontFamily: "var(--mono)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            M
          </div>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            MissionControl
          </span>
        </div>
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
