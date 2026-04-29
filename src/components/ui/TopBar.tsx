import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function useTrafficLightPad() {
  const [pad, setPad] = useState(isMac ? 60 : 0);
  useEffect(() => {
    if (!isMac) return;
    const api = (window as any).electronAPI;
    if (!api?.onFullScreenChange) return;
    api.isFullScreen?.().then((fs: boolean) => setPad(fs ? 0 : 60));
    return api.onFullScreenChange((fs: boolean) => setPad(fs ? 0 : 60));
  }, []);
  return pad;
}

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
  const trafficLightPad = useTrafficLightPad();
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
          paddingLeft: trafficLightPad,
          transition: "padding-left 150ms ease",
          ["WebkitAppRegion" as any]: "no-drag",
        }}
      >
        <div onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
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
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            Mission Control{" "}
            <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>
              (by <span style={{ color: "var(--accent)" }}>AgentSystem</span>)
            </span>
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
