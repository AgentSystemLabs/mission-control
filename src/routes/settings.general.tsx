import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import { api } from "~/lib/api";
import { queryKeys, settingsQueryOptions, useSettings } from "~/queries";
import {
  ACCENT_COLORS,
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
  type AccentColorId,
} from "~/lib/accent-colors";

export const Route = createFileRoute("/settings/general")({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQueryOptions()),
  component: GeneralSettingsPage,
});

function GeneralSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const disabled = settings?.agentSystemBannerDisabled ?? false;
  const accentColor = settings?.accentColor ?? DEFAULT_ACCENT_COLOR;

  const setBannerDisabled = async (agentSystemBannerDisabled: boolean) => {
    const next = await api.updateSettings({ agentSystemBannerDisabled });
    queryClient.setQueryData(queryKeys.settings, next);
  };

  const setAccentColor = async (nextAccentColor: AccentColorId) => {
    applyAccentColor(nextAccentColor);
    queryClient.setQueryData(queryKeys.settings, {
      ...settings,
      apiToken: settings?.apiToken ?? "",
      agentSystemBannerDisabled: disabled,
      accentColor: nextAccentColor,
    });
    const next = await api.updateSettings({ accentColor: nextAccentColor });
    queryClient.setQueryData(queryKeys.settings, next);
  };

  return (
    <>
      <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
        General
      </h1>
      <SettingsSection
        title="General"
        subtitle="Control app-wide interface preferences."
      >
        <Field label="Theme color">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(142px, 1fr))",
              gap: 10,
            }}
          >
            {ACCENT_COLORS.map((color) => {
              const selected = color.id === accentColor;
              return (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => setAccentColor(color.id)}
                  aria-pressed={selected}
                  title={color.name}
                  style={{
                    minHeight: 42,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 10px",
                    background: selected ? "var(--accent-faint)" : "var(--surface-0)",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 7,
                    color: selected ? "var(--text)" : "var(--text-dim)",
                    cursor: "pointer",
                    textAlign: "left",
                    boxShadow: selected ? "0 0 0 1px var(--accent-border)" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: color.value,
                      border: "1px solid color-mix(in srgb, var(--text) 26%, transparent)",
                      boxShadow: selected ? `0 0 14px ${color.value}66` : "none",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{color.name}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="AgentSystem.dev banner">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              padding: "12px 14px",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
                Show promotional banner
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
                Dismissing the banner only hides it until the app reloads.
              </div>
            </div>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--text-dim)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <input
                type="checkbox"
                checked={!disabled}
                onChange={(event) => setBannerDisabled(!event.currentTarget.checked)}
              />
              Show banner
            </label>
          </div>
        </Field>
      </SettingsSection>
    </>
  );
}
