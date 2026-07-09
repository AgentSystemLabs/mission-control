import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Icon } from "~/components/ui/Icon";
import { SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useProviderUsage, useSettings } from "~/queries";
import {
  DEFAULT_PROVIDER_USAGE_IDS,
  PROVIDER_USAGE_CATALOG,
  type ProviderUsageId,
  type ProviderUsageSnapshot,
} from "~/shared/provider-usage";

type UsagePatch = Partial<
  Pick<
    AppSettings,
    | "claudeUsageLimitsEnabled"
    | "claudeUsageLimitsShowSession"
    | "claudeUsageLimitsShowWeekly"
    | "providerUsageEnabled"
    | "providerUsageIds"
  >
>;

/** Default agent providers first, then the rest of the catalog alphabetically. */
const SETTINGS_PROVIDER_ORDER: readonly (typeof PROVIDER_USAGE_CATALOG)[number][] = [
  ...PROVIDER_USAGE_CATALOG.filter((p) => p.defaultEnabled),
  ...PROVIDER_USAGE_CATALOG.filter((p) => !p.defaultEnabled).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  ),
];

export function UsageSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const enabled = settings?.providerUsageEnabled ?? false;
  const providerIds = settings?.providerUsageIds ?? DEFAULT_PROVIDER_USAGE_IDS;
  const claudeShowSession = settings?.claudeUsageLimitsShowSession ?? true;
  const claudeShowWeekly = settings?.claudeUsageLimitsShowWeekly ?? true;
  const claudeOn = providerIds.includes("claude");
  const [query, setQuery] = useState("");

  // Live status shares the indicator's query, so this adds no extra polling.
  const { data: usage } = useProviderUsage(enabled, providerIds);
  const statusById = useMemo(() => {
    const map = new Map<ProviderUsageId, ProviderUsageSnapshot>();
    for (const p of usage?.providers ?? []) map.set(p.id, p);
    return map;
  }, [usage]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SETTINGS_PROVIDER_ORDER;
    return SETTINGS_PROVIDER_ORDER.filter(
      (p) => p.displayName.toLowerCase().includes(q) || p.id.includes(q),
    );
  }, [query]);

  const needsAuth = useMemo(
    () =>
      providerIds
        .map((id) => statusById.get(id))
        .filter((p): p is ProviderUsageSnapshot => !!p && p.status === "unauthenticated"),
    [providerIds, statusById],
  );

  const update = async (patch: UsagePatch) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.settings });
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    if (previous) {
      queryClient.setQueryData<AppSettings>(queryKeys.settings, { ...previous, ...patch });
    }
    try {
      const next = await api.updateSettings(patch);
      queryClient.setQueryData(queryKeys.settings, next);
    } catch (e) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      toast.error(e instanceof Error ? e.message : "Could not update usage settings");
    }
  };

  const toggleProvider = (id: ProviderUsageId) => {
    const on = providerIds.includes(id);
    if (on && providerIds.length === 1) {
      // The server coerces an empty list back to the defaults, which would
      // silently re-enable three providers — block the last uncheck instead.
      toast("At least one provider stays enabled — use the top-bar toggle to hide usage.");
      return;
    }
    const next = on ? providerIds.filter((p) => p !== id) : [...providerIds, id];
    void update({ providerUsageIds: next });
  };

  return (
    <SettingsSection
      title="Usage"
      subtitle="Multi-provider usage limits in the top bar (CodexBar capability, Windows + macOS). Off by default so the chrome stays quiet."
      headingLevel="h1"
    >
      <ToggleRow
        title="Show usage in top bar"
        description="One compact control — a ring plus the most-consumed window. Click it for per-provider windows and resets."
        checked={enabled}
        onChange={(next) => void update({ providerUsageEnabled: next })}
        label="Show provider usage in top bar"
      />

      <SettingsSection
        title="Providers"
        subtitle="Every provider has a live adapter. Credentials come from env vars, ~/.codexbar/config.json, CLI auth files, or cookies; providers without credentials report “sign in”, never a dead stub."
        headingLevel="h2"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            opacity: enabled ? 1 : 0.6,
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "7px 10px",
            }}
          >
            <Icon name="search" size={12} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter providers…"
              aria-label="Filter providers"
              disabled={!enabled}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text)",
                fontFamily: "var(--mono)",
                fontSize: 12,
              }}
            />
          </div>
          <span
            style={{
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {providerIds.length} of {PROVIDER_USAGE_CATALOG.length} enabled
          </span>
        </div>

        <div
          role="group"
          aria-label="Providers to show in the top bar"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            opacity: enabled ? 1 : 0.6,
          }}
        >
          {filtered.map((meta) => {
            const on = providerIds.includes(meta.id);
            const snapshot = enabled && on ? statusById.get(meta.id) : undefined;
            return (
              <ProviderChip
                key={meta.id}
                name={meta.displayName}
                on={on}
                disabled={!enabled}
                snapshot={snapshot}
                onToggle={() => toggleProvider(meta.id)}
              />
            );
          })}
          {filtered.length === 0 && (
            <span style={{ color: "var(--text-dim)", fontSize: 12, padding: "6px 2px" }}>
              No providers match “{query}”.
            </span>
          )}
        </div>

        {enabled && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
            }}
          >
            <LegendDot color="var(--status-done)" label="ok" />
            <LegendDot color="var(--text-faint)" label="sign in" />
            <LegendDot color="var(--status-warning)" label="rate-limited" />
            <LegendDot color="var(--status-failed)" label="error" />
          </div>
        )}
      </SettingsSection>

      {enabled && needsAuth.length > 0 && (
        <SettingsSection
          title="Needs sign-in"
          subtitle="These enabled providers have no usable credentials yet. The hint names the env var, config entry, or auth file each adapter looks for."
          headingLevel="h2"
        >
          {needsAuth.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "9px 12px",
                background: "var(--surface-0)",
                border: "1px solid var(--border)",
                borderRadius: 7,
              }}
            >
              <span
                style={{
                  color: "var(--text)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  flexShrink: 0,
                  minWidth: 90,
                }}
              >
                {p.displayName}
              </span>
              <span
                style={{
                  color: "var(--text-dim)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                }}
              >
                {p.error ?? "No credentials found."}
              </span>
            </div>
          ))}
        </SettingsSection>
      )}

      {claudeOn && (
        <SettingsSection
          title="Claude windows"
          subtitle="Which Claude rate-limit windows appear when Claude is enabled."
          headingLevel="h2"
        >
          <ToggleRow
            title="Session (5h)"
            description="Show the rolling 5-hour session window."
            checked={claudeShowSession}
            disabled={!enabled}
            onChange={(next) => void update({ claudeUsageLimitsShowSession: next })}
            label="Show session usage"
          />
          <ToggleRow
            title="Weekly"
            description="Show the weekly (all models) window."
            checked={claudeShowWeekly}
            disabled={!enabled}
            onChange={(next) => void update({ claudeUsageLimitsShowWeekly: next })}
            label="Show weekly usage"
          />
        </SettingsSection>
      )}
    </SettingsSection>
  );
}

function ProviderChip({
  name,
  on,
  disabled,
  snapshot,
  onToggle,
}: {
  name: string;
  on: boolean;
  disabled: boolean;
  snapshot?: ProviderUsageSnapshot;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={`Show ${name} usage`}
      disabled={disabled}
      onClick={onToggle}
      title={snapshot?.error ? `${name}: ${snapshot.error}` : name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        border: `1px solid ${on ? "var(--accent-border)" : "var(--border)"}`,
        background: on ? "var(--accent-faint)" : "var(--surface-0)",
        color: on ? "var(--text)" : "var(--text-dim)",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {snapshot && (
        <span
          aria-hidden
          title={snapshot.status}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: statusDotColor(snapshot),
          }}
        />
      )}
      {name}
      {on && <Icon name="check" size={10} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />}
    </button>
  );
}

function statusDotColor(s: ProviderUsageSnapshot): string {
  switch (s.status) {
    case "ok":
      return "var(--status-done)";
    case "rate_limited":
      return "var(--status-warning)";
    case "error":
      return "var(--status-failed)";
    default:
      return "var(--text-faint)";
  }
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: "50%", background: color }}
      />
      {label}
    </span>
  );
}
