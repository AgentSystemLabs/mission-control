import { useLicense } from "~/queries";
import { type LicenseState } from "~/shared/license";

type Tier = "lite" | "pro";

function deriveTier(license: LicenseState | undefined): Tier {
  if (!license || !license.hasKey) return "lite";
  return license.status === "active" ? "pro" : "lite";
}

const TIER_STYLE: Record<Tier, { label: string; bg: string; border: string; fg: string }> = {
  lite: {
    label: "Lite",
    bg: "transparent",
    border: "var(--border)",
    fg: "var(--text-dim)",
  },
  pro: {
    label: "Pro",
    bg: "var(--accent-dim)",
    border: "var(--accent)",
    fg: "var(--accent)",
  },
};

export function LicenseBadge({ onClick }: { onClick: () => void }) {
  const { data: license } = useLicense();
  const tier = deriveTier(license);
  const s = TIER_STYLE[tier];

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        tier === "lite"
          ? "Mission Control Lite — click to activate Pro"
          : "Mission Control Pro — click to manage license"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        border: `1px solid ${s.border}`,
        background: s.bg,
        color: s.fg,
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {s.label}
    </button>
  );
}
