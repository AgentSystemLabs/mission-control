import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProviderUsageSnapshot,
  ProviderUsageWindow,
} from "~/shared/provider-usage";
import { DEFAULT_PROVIDER_USAGE_IDS } from "~/shared/provider-usage";
import { Btn } from "~/components/ui/Btn";
import { OPEN_SETTINGS_EVENT } from "~/lib/design-meta";
import { useProviderUsage, useSettings } from "~/queries";

/**
 * Compact multi-provider usage control.
 *
 * Collapsed: one quiet chip — one status dot per reporting provider (colored
 * by that provider's own worst window band; hollow on error/unavailable).
 * While every provider is comfortable the dots are the whole chip; text
 * appears only when it can name a provider that needs attention (`codex 91%`
 * past the warning band, `codex rate-limited` when blocked). Dot order
 * matches settings order, which is also the popover row order — dots map 1:1
 * to rows. When exactly one healthy metered provider is reporting, the dots
 * give way to a radial gauge with the percent inside — a lone number has an
 * unambiguous owner. Expanded: a CardFrame popover of flat hairline-separated sections —
 * each led by the same status dot as the chip — with per-window bars
 * (bar + % + reset), a one-line inline reason for erroring providers, refresh,
 * and a shortcut to Settings → Usage. Signed-out providers are omitted
 * everywhere (signing in is a Settings → Usage task, not live status).
 * Renders nothing when the feature is off so the chrome stays uncluttered.
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);

  // Fixed positioning at whole-pixel coordinates. The popover overlaps the
  // WebGL terminal canvases, so Chromium composites it on its own GPU layer;
  // anchoring it with `absolute` inherited the trigger's fractional geometry
  // (half-pixel bar centering + text-width chip edges), and a composited
  // layer at a fractional offset is bilinearly resampled — every glyph in
  // the popover rendered blurry. Rounding the measured anchor fixes it.
  const placePopover = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopoverPos({
      top: Math.round(rect.bottom + 8),
      right: Math.round(window.innerWidth - rect.right),
    });
  }, []);

  const providers = useMemo(() => {
    if (!data?.providers) return [];
    return data.providers.map((p) => filterProviderWindows(p, showSession, showWeekly));
  }, [data, showSession, showWeekly]);

  // Move focus into the dialog on open so keyboard/SR users land inside it;
  // Escape (below) hands focus back to the trigger.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

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
    window.addEventListener("resize", placePopover);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", placePopover);
    };
  }, [open, placePopover]);

  if (!enabled || providerIds.length === 0) return null;

  const rateLimited = providers.find((p) => p.status === "rate_limited");
  const worst = pickWorstWindow(providers);
  // Healthy rest state is dots-only (label: null) — a bare number without an
  // owner is noise. Text appears only when it can name a provider that needs
  // attention, tinted with the same band color as that provider's dot.
  const collapsed: { label: string; color: string } | null = rateLimited
    ? {
        // Failed-red to match the dot — rate-limited means blocked, and one
        // state must not speak two colors at once.
        label: `${rateLimited.displayName.toLowerCase()} rate-limited`,
        color: "var(--status-failed)",
      }
    : worst && worst.pct >= WARN_PCT
      ? {
          label: `${worst.providerName.toLowerCase()} ${worst.pct}%`,
          color: usageColor(worst.pct),
        }
      : collapsedFallback(providers, isLoading);

  // Signed-out providers are a Settings → Usage task, not live status — both
  // the chip dots and the popover cover only providers with something to
  // report (data, rate-limit, error).
  const visibleProviders = providers.filter((p) => p.status !== "unauthenticated");

  // One dot per reporting provider; hollow placeholders for configured ids
  // until the first snapshot arrives so the chip has a stable shape from
  // first paint.
  const dots: DotState[] =
    providers.length > 0
      ? visibleProviders.map((p) => ({ key: p.id, ...providerDotState(p) }))
      : providerIds.map((id) => ({ key: id, filled: false, color: "var(--text-dim)" }));

  // A single healthy metered provider gets a radial gauge with the percent
  // inside instead of a lone dot — one provider means the number has an
  // unambiguous owner, so the chip can carry it at rest. The gauge already
  // speaks the warning through arc length + band color, so the collapsed
  // text label is redundant and suppressed. When the provider reports both a
  // session and a weekly window, the gauge doubles up: outer ring = weekly,
  // inner ring = session (5h), number = session — the more immediate limit.
  const solo = providers.length > 0 && visibleProviders.length === 1 ? visibleProviders[0] : null;
  const soloPct = solo && solo.status === "ok" ? worstMeteredPct(solo) : null;
  const soloSessionPct = soloWindowPct(solo, "session");
  const soloWeeklyPct = soloWindowPct(solo, "weekly");

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
        onClick={() => {
          if (!open) placePopover();
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaSummary(visibleProviders)}
        title={buildTooltip(visibleProviders)}
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
          {soloPct !== null ? (
            <UsageRing
              pct={soloSessionPct ?? soloPct}
              outerPct={soloSessionPct !== null ? soloWeeklyPct : null}
            />
          ) : (
            <ProviderDots dots={dots} />
          )}
          {soloPct === null && collapsed && (
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                color: collapsed.color,
              }}
            >
              {collapsed.label}
            </span>
          )}
        </span>
      </button>

      {open && popoverPos && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Provider usage details"
          tabIndex={-1}
          className="mc-usage-pop mc-usage-glass"
          style={{
            position: "fixed",
            top: popoverPos.top,
            right: popoverPos.right,
            width: 352,
            maxWidth: "calc(100vw - 32px)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 200,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 2px 4px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
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
              {data && (
                <div
                  style={{
                    color: "var(--text-faint)",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                  }}
                  title="Auto-refreshes every 45 seconds"
                >
                  {isFetching
                    ? "refreshing…"
                    : `updated ${timeFmt.format(new Date(data.fetchedAt))}`}
                </div>
              )}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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
              overflowX: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {visibleProviders.length === 0 && (
              <div
                style={{
                  padding: "16px 8px",
                  color: "var(--text-dim)",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                {isLoading && providers.length === 0
                  ? "Checking provider limits…"
                  : providers.length > 0
                    ? "All providers signed out — connect them in usage settings."
                    : "No providers enabled — add them in usage settings."}
              </div>
            )}
            {visibleProviders.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && (
                  <div
                    aria-hidden
                    style={{
                      height: 1,
                      flexShrink: 0,
                      margin: "0 6px",
                      background: "var(--border)",
                    }}
                  />
                )}
                <ProviderSection snapshot={p} />
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const MAX_DOTS = 5;

type DotState = { key: string; filled: boolean; color: string };

/**
 * One status dot per enabled provider, in settings order (same order as the
 * popover rows). Filled = reporting usage, colored by that provider's worst
 * window band; hollow = not reporting (signed out, unavailable, or error).
 */
function ProviderDots({ dots }: { dots: DotState[] }) {
  const visible = dots.slice(0, MAX_DOTS);
  const overflow = dots.length - visible.length;
  return (
    <span
      aria-hidden
      style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
    >
      {visible.map((d) => (
        <StatusDot key={d.key} filled={d.filled} color={d.color} />
      ))}
      {overflow > 0 && (
        <span style={{ color: "var(--text-faint)", fontSize: 10 }}>+{overflow}</span>
      )}
    </span>
  );
}

// 22px (up from 18) buys the radius the second concentric ring needs while
// still clearing the 30px mc-btn-md chip.
const RING_SIZE = 22;
const RING_STROKE = 2;
const RING_GAP = 1;

/**
 * Single-provider chip face: a radial gauge — track ring, band-colored arc,
 * percent number centered inside. With `outerPct` it becomes a double radial:
 * the outer ring carries the weekly window, the inner ring (and the number)
 * the session window. Without it the lone ring takes the full radius. Only
 * rendered for a healthy metered provider; every other state falls back to
 * dot + label.
 */
function UsageRing({ pct, outerPct }: { pct: number; outerPct?: number | null }) {
  const center = RING_SIZE / 2;
  const outerR = (RING_SIZE - RING_STROKE) / 2;
  const double = outerPct !== null && outerPct !== undefined;
  const innerR = double ? outerR - RING_STROKE - RING_GAP : outerR;
  return (
    <span
      aria-hidden
      style={{
        position: "relative",
        width: RING_SIZE,
        height: RING_SIZE,
        flexShrink: 0,
        display: "inline-flex",
      }}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        {double && <RingArc pct={outerPct} r={outerR} center={center} />}
        <RingArc pct={pct} r={innerR} center={center} />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--mono)",
          // Three digits (100) need a hair less type to clear the arc.
          fontSize: pct >= 100 ? 6.5 : 8,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          // Full text color — at this size a dimmed number is decoration.
          color: "var(--text)",
          lineHeight: 1,
        }}
      >
        {pct}
      </span>
    </span>
  );
}

/** One gauge ring: faint full-circle track + band-colored progress arc. */
function RingArc({ pct, r, center }: { pct: number; r: number; center: number }) {
  const c = 2 * Math.PI * r;
  return (
    <>
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="color-mix(in srgb, var(--text) 14%, transparent)"
        strokeWidth={RING_STROKE}
      />
      <circle
        className="mc-usage-ring-arc"
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={usageColor(pct)}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
      />
    </>
  );
}

/** A specific metered window of the solo provider, clamped 0–100, or null. */
function soloWindowPct(solo: ProviderUsageSnapshot | null, id: string): number | null {
  if (!solo || solo.status !== "ok") return null;
  const w = solo.windows.find((w) => w.id === id);
  return w && w.utilization !== null
    ? Math.max(0, Math.min(100, Math.round(w.utilization)))
    : null;
}

/**
 * The status-dot glyph — identical rendering in the chip and popover rows.
 * 7px: the smallest size at which the hollow (not-reporting) ring survives a
 * glance; at 6px the 1.5px inset stroke reads as a filled dot.
 */
function StatusDot({ filled, color }: { filled: boolean; color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        flexShrink: 0,
        background: filled ? color : "transparent",
        boxShadow: filled ? "none" : `inset 0 0 0 1.5px ${color}`,
      }}
    />
  );
}

/** Dot presentation for a provider's own state (independent of the others). */
function providerDotState(p: ProviderUsageSnapshot): { filled: boolean; color: string } {
  switch (p.status) {
    case "ok": {
      const pct = worstMeteredPct(p);
      // Meterless (balance-only) provider: connected and healthy — same
      // green as a low-utilization metered provider, not a neutral that
      // reads as "off".
      if (pct === null) return { filled: true, color: "var(--status-done)" };
      return { filled: true, color: usageColor(pct) };
    }
    case "rate_limited":
      return { filled: true, color: "var(--status-failed)" };
    case "error":
      return { filled: false, color: "var(--status-failed)" };
    case "unauthenticated":
    case "unavailable":
    default:
      return { filled: false, color: "var(--text-dim)" };
  }
}

/** Worst metered window within one provider, 0–100, or null when meterless. */
function worstMeteredPct(p: ProviderUsageSnapshot): number | null {
  let worst: number | null = null;
  for (const w of p.windows) {
    if (w.utilization === null) continue;
    const pct = Math.max(0, Math.min(100, Math.round(w.utilization)));
    if (worst === null || pct > worst) worst = pct;
  }
  return worst;
}

/** Screen-reader summary of every provider, mirroring the dots + label. */
function ariaSummary(providers: ProviderUsageSnapshot[]): string {
  if (providers.length === 0) return "Provider usage limits";
  const parts = providers.map((p) => {
    switch (p.status) {
      case "ok": {
        const pct = worstMeteredPct(p);
        return pct === null ? `${p.displayName} ok` : `${p.displayName} ${pct}%`;
      }
      case "unauthenticated":
        return `${p.displayName} signed out`;
      case "rate_limited":
        return `${p.displayName} rate-limited`;
      case "error":
        return `${p.displayName} error`;
      case "unavailable":
        return `${p.displayName} unavailable`;
      default:
        return `${p.displayName} ${p.status}`;
    }
  });
  return `Provider usage: ${parts.join(", ")}`;
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

/**
 * Text for the rest states that can't speak through the dots alone: nothing
 * fetched yet, or every provider signed out. Healthy data → null (dots only).
 * Rate-limited/warning providers are handled before this.
 */
function collapsedFallback(
  providers: ProviderUsageSnapshot[],
  isLoading: boolean,
): { label: string; color: string } | null {
  if (isLoading && providers.length === 0)
    return { label: "usage", color: "var(--text-dim)" };
  if (providers.length === 0) return { label: "usage", color: "var(--text-dim)" };
  if (providers.every((p) => p.status === "unauthenticated"))
    return { label: "sign in", color: "var(--text-dim)" };
  return null;
}

/** The most-consumed window across all providers with usable data. */
function pickWorstWindow(
  providers: ProviderUsageSnapshot[],
): { providerName: string; pct: number } | null {
  let best: { providerName: string; pct: number } | null = null;
  for (const p of providers) {
    if (p.status !== "ok") continue;
    const pct = worstMeteredPct(p);
    if (pct === null) continue; // meterless (balance) windows only
    if (!best || pct > best.pct) best = { providerName: p.displayName, pct };
  }
  return best;
}

/**
 * One flat provider section: the provider's chip dot + name + status tag on
 * the lead line, window rows aligned beneath the name. Providers that aren't
 * reporting (signed out, error, unavailable) stay a single quiet line — the
 * reason rides inline, truncated, with the full text in the row's tooltip —
 * so providers with real data own the panel's vertical space.
 */
function ProviderSection({ snapshot }: { snapshot: ProviderUsageSnapshot }) {
  const dot = providerDotState(snapshot);
  const reporting = snapshot.status === "ok" || snapshot.status === "rate_limited";
  const hint = reporting ? "" : (snapshot.error ?? "");
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 5, padding: "7px 6px" }}
      title={hint || undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusDot filled={dot.filled} color={dot.color} />
        <span
          style={{
            color: reporting ? "var(--text)" : "var(--text-dim)",
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {snapshot.displayName}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--text-faint)",
            fontSize: 11,
            textAlign: "right",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {hint}
        </span>
        <StatusTag snapshot={snapshot} />
      </div>
      {snapshot.windows.map((w) => (
        <WindowRow key={w.id} window={w} />
      ))}
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
      return { label: "rate-limited", color: "var(--status-failed)" };
    case "unavailable":
      return { label: "unavailable", color: "var(--text-faint)" };
    case "error":
      return { label: "error", color: "var(--status-failed)" };
    default:
      return { label: s.status, color: "var(--text-faint)" };
  }
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
          // Align window labels under the provider name (dot 6px + gap 8px).
          paddingLeft: 14,
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
        paddingLeft: 14,
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
          height: 4,
          borderRadius: 999,
          // Text-mix track instead of a surface token: the popover surface is
          // itself near --surface-2, which made the empty track invisible.
          background: "color-mix(in srgb, var(--text) 9%, transparent)",
          overflow: "hidden",
        }}
      >
        <span
          className="mc-usage-fill"
          style={{
            position: "absolute",
            insetBlock: 0,
            insetInlineStart: 0,
            width: `${pct}%`,
            background: usageColor(pct),
            borderRadius: 999,
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
          // Wide enough for "↻ Fri 01:50" at 11px mono — narrower clips.
          width: 78,
          flexShrink: 0,
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {reset ? (
          <>
            {/* Glyph is visual shorthand for "resets" — keep it out of SR output. */}
            <span aria-hidden>{"↻ "}</span>
            {reset}
          </>
        ) : (
          ""
        )}
      </span>
    </div>
  );
}

/** Utilization at which a provider is worth naming in the collapsed chip. */
const WARN_PCT = 70;
const HOT_PCT = 90;

function usageColor(pct: number): string {
  if (pct >= HOT_PCT) return "var(--status-failed)";
  if (pct >= WARN_PCT) return "var(--status-warning)";
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
