import { useLicense } from "~/queries";
import { isGraceExpired, type LicenseState } from "~/shared/license";

type Tier = "lite" | "pro" | "pro-warning" | "pro-error";

// Badge tier is finer-grained than the entitlement gate (`isProTier`); the
// gate is binary, but the badge surfaces "grace" / "revoked" so the user
// understands *why* Pro features are degraded.
function deriveTier(license: LicenseState | undefined): Tier {
  if (!license || !license.hasKey) return "lite";
  // An "invalid" key never granted Pro — surface as Lite, not "Pro · revoked".
  // Only "revoked" means the user previously had Pro and lost it.
  if (license.status === "invalid") return "lite";
  if (license.status === "revoked") return "pro-error";
  if (isGraceExpired(license)) return "pro-warning";
  return "pro";
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
  "pro-warning": {
    label: "Pro · grace",
    bg: "rgba(234, 179, 8, 0.12)",
    border: "rgba(234, 179, 8, 0.55)",
    fg: "rgb(234, 179, 8)",
  },
  "pro-error": {
    label: "Pro · revoked",
    bg: "rgba(239, 68, 68, 0.12)",
    border: "rgba(239, 68, 68, 0.55)",
    fg: "var(--status-failed)",
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
