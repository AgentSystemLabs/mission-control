import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProviderUsageSnapshot,
  ProviderUsageWindow,
} from "~/shared/provider-usage";
import { DEFAULT_PROVIDER_USAGE_IDS } from "~/shared/provider-usage";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { OPEN_SETTINGS_EVENT } from "~/lib/design-meta";
import { useProviderUsage, useSettings } from "~/queries";

/**
 * Compact multi-provider usage control (CodexBar fork).
 *
 * Collapsed: one quiet chip — a small utilization ring plus the single worst
 * window across enabled providers (`codex 91%`). Expanded: a CardFrame popover
 * with per-provider windows (bar + % + reset), auth help for unauthenticated
 * providers, refresh, and a shortcut to Settings → Usage. Renders nothing when
 * the feature is off so the chrome stays uncluttered.
 */
export function ProviderUsageIndicator() {
  const { data: settings } = useSettings();
  const enabled = settings?.providerUsageEnabled ?? false;
  const providerIds = settings?.providerUsageIds ?? DEFAULT_PROVIDER_USAGE_IDS;
  const showSession = settings?.claudeUsageLimitsShowSession ?? true;
  const showWeekly = settings?.claudeUsageLimitsShowWeekly ?? true;
  const { data, isLoading, isFetching, refetch } = useProviderUsage(enabled, providerIds);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const providers = useMemo(() => {
    if (!data?.providers) return [];
    return data.providers.map((p) => filterProviderWindows(p, showSession, showWeekly));
  }, [data, showSession, showWeekly]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!enabled || providerIds.length === 0) return null;

  const worst = pickWorstWindow(providers);
  const collapsedLabel = worst
    ? `${worst.providerName.toLowerCase()} ${worst.pct}%`
    : collapsedFallbackLabel(providers, isLoading);

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        display: "inline-flex",
        ["WebkitAppRegion" as unknown as string]: "no-drag",
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="mc-btn mc-btn-ghost mc-btn-md"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Provider usage limits"
        title={buildTooltip(providers)}
        style={{ paddingInline: 8 }}
      >
        <span
          className="mc-btn-content"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          <UsageRing pct={worst?.pct ?? null} dim={!worst} />
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              color: worst ? "var(--text)" : "var(--text-dim)",
            }}
          >
            {collapsedLabel}
          </span>
        </span>
      </button>

      {open && (
        <CardFrame
          role="dialog"
          aria-label="Provider usage details"
          solid
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 340,
            maxWidth: "calc(100vw - 32px)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            boxShadow: "0 16px 36px rgba(0,0,0,0.46)",
            zIndex: 200,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 2px 4px",
            }}
          >
            <div
              style={{
                color: "var(--text)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Provider usage
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  color: "var(--text-faint)",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {providers.length}
              </span>
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                icon="refresh"
                disabled={isFetching}
                onClick={() => void refetch()}
                aria-label="Refresh provider usage"
                title="Refresh"
                style={{ width: 26, padding: 0, opacity: isFetching ? 0.5 : 1 }}
              />
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                icon="settings"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(
                    new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { panel: "usage" } }),
                  );
                }}
                aria-label="Open usage settings"
                title="Usage settings"
                style={{ width: 26, padding: 0 }}
              />
            </div>
          </div>

          <div
            style={{
              maxHeight: 360,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              paddingRight: 2,
            }}
          >
            {providers.length === 0 && (
              <div
                style={{
                  padding: "16px 8px",
                  color: "var(--text-dim)",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                {isLoading ? "Checking provider limits…" : "No providers enabled."}
              </div>
            )}
            {providers.map((p) => (
              <ProviderRow key={p.id} snapshot={p} />
            ))}
          </div>

          {data && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: "var(--text-faint)",
                fontFamily: "var(--mono)",
                fontSize: 10,
                padding: "2px 2px 0",
              }}
            >
              <span>{isFetching ? "refreshing…" : `updated ${timeFmt.format(new Date(data.fetchedAt))}`}</span>
              <span>auto-refresh 45s</span>
            </div>
          )}
        </CardFrame>
      )}
    </div>
  );
}

/** Small donut showing the worst utilization; empty track when no data. */
function UsageRing({ pct, dim }: { pct: number | null; dim: boolean }) {
  const size = 14;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{ flexShrink: 0, transform: "rotate(-90deg)", opacity: dim ? 0.5 : 1 }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth={stroke}
      />
      {pct !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={usageColor(clamped)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
        />
      )}
    </svg>
  );
}

function filterProviderWindows(
  snapshot: ProviderUsageSnapshot,
  showSession: boolean,
  showWeekly: boolean,
): ProviderUsageSnapshot {
  if (snapshot.id !== "claude") return snapshot;
  return {
    ...snapshot,
    windows: snapshot.windows.filter((w) => {
      if (w.id === "session") return showSession;
      if (w.id === "weekly" || w.id === "weeklyOpus") return showWeekly;
      return true;
    }),
  };
}

/** Quiet one-word state when no provider has a renderable window yet. */
function collapsedFallbackLabel(
  providers: ProviderUsageSnapshot[],
  isLoading: boolean,
): string {
  if (isLoading || providers.length === 0) return "usage";
  if (providers.some((p) => p.status === "rate_limited")) return "rate-limited";
  if (providers.every((p) => p.status === "unauthenticated")) return "sign in";
  return "usage";
}

/** The most-consumed window across all providers with usable data. */
function pickWorstWindow(
  providers: ProviderUsageSnapshot[],
): { providerName: string; pct: number } | null {
  let best: { providerName: string; pct: number } | null = null;
  for (const p of providers) {
    if (p.status !== "ok") continue;
    for (const w of p.windows) {
      if (w.utilization === null) continue; // meterless (balance) windows
      const pct = Math.max(0, Math.min(100, Math.round(w.utilization)));
      if (!best || pct > best.pct) best = { providerName: p.displayName, pct };
    }
  }
  return best;
}

function ProviderRow({ snapshot }: { snapshot: ProviderUsageSnapshot }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "8px 8px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 600 }}>
          {snapshot.displayName}
        </span>
        <StatusTag snapshot={snapshot} />
      </div>
      {snapshot.windows.map((w) => (
        <WindowRow key={w.id} window={w} />
      ))}
      {snapshot.status === "unauthenticated" && (
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: 11,
            lineHeight: 1.4,
          }}
          title={snapshot.error}
        >
          {authHelp(snapshot)}
        </div>
      )}
      {snapshot.status === "error" && snapshot.error && (
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: 11,
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={snapshot.error}
        >
          {snapshot.error}
        </div>
      )}
    </div>
  );
}

function StatusTag({ snapshot }: { snapshot: ProviderUsageSnapshot }) {
  const { label, color } = statusPresentation(snapshot);
  if (!label) return null;
  return (
    <span
      style={{
        color,
        fontFamily: "var(--mono)",
        fontSize: 10,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

function statusPresentation(s: ProviderUsageSnapshot): { label: string | null; color: string } {
  switch (s.status) {
    case "ok":
      return { label: null, color: "var(--text-faint)" };
    case "unauthenticated":
      return { label: "sign in", color: "var(--text-faint)" };
    case "rate_limited":
      return { label: "rate-limited", color: "var(--status-warning)" };
    case "unavailable":
      return { label: "unavailable", color: "var(--text-faint)" };
    case "error":
      return { label: "error", color: "var(--status-failed)" };
    default:
      return { label: s.status, color: "var(--text-faint)" };
  }
}

/** Human hint for how to authenticate, derived from the adapter's reason string. */
function authHelp(s: ProviderUsageSnapshot): string {
  const reason = s.error?.trim();
  if (reason) return `No credentials — ${reason}`;
  return "No credentials found for this provider.";
}

function WindowRow({ window }: { window: ProviderUsageWindow }) {
  const reset = formatReset(window.resetsAt);
  if (window.utilization === null) {
    // Meterless window (prepaid balance, spend total) — show the value, no bar.
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--mono)",
          fontSize: 11,
        }}
      >
        <span
          style={{
            color: "var(--text-dim)",
            width: 52,
            flexShrink: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={window.label}
        >
          {window.label}
        </span>
        <span
          style={{
            flex: 1,
            textAlign: "right",
            color: "var(--text)",
            fontVariantNumeric: "tabular-nums",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {window.detail ?? "—"}
        </span>
        <span
          style={{
            color: "var(--text-faint)",
            width: 64,
            flexShrink: 0,
            textAlign: "right",
            whiteSpace: "nowrap",
          }}
        >
          {reset ? `↻ ${reset}` : ""}
        </span>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round(window.utilization)));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--mono)",
        fontSize: 11,
      }}
    >
      <span
        style={{
          color: "var(--text-dim)",
          width: 52,
          flexShrink: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={window.label}
      >
        {window.label}
      </span>
      <span
        aria-hidden
        style={{
          position: "relative",
          flex: 1,
          height: 5,
          borderRadius: 3,
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            insetBlock: 0,
            insetInlineStart: 0,
            width: `${pct}%`,
            background: usageColor(pct),
            borderRadius: 3,
          }}
        />
      </span>
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          color: "var(--text)",
          width: 34,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {pct}%
      </span>
      <span
        style={{
          color: "var(--text-faint)",
          width: 64,
          flexShrink: 0,
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {reset ? `↻ ${reset}` : ""}
      </span>
    </div>
  );
}

function usageColor(pct: number): string {
  if (pct >= 90) return "var(--status-failed)";
  if (pct >= 70) return "var(--status-warning)";
  return "var(--status-done)";
}

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${weekdayFmt.format(d)} ${timeFmt.format(d)}`;
}

function buildTooltip(providers: ProviderUsageSnapshot[]): string {
  if (providers.length === 0) return "Provider usage limits";
  return providers
    .map((p) => {
      if (p.windows.length === 0) {
        return `${p.displayName}: ${p.status}${p.error ? ` — ${p.error}` : ""}`;
      }
      const parts = p.windows.map((w) => {
        const reset = formatReset(w.resetsAt);
        const value = w.utilization === null ? (w.detail ?? "—") : `${Math.round(w.utilization)}%`;
        return `${w.label} ${value}${reset ? ` ↻ ${reset}` : ""}`;
      });
      return `${p.displayName}: ${parts.join(" · ")}`;
    })
    .join("\n");
}
