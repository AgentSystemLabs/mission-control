import { useQueryClient } from "@tanstack/react-query";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import {
  ACCENT_COLORS,
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
  type AccentColorId,
} from "~/lib/accent-colors";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";

export function ThemeSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const accentColor = settings?.accentColor ?? DEFAULT_ACCENT_COLOR;

  const optimisticSettings = (
    patch: Partial<Pick<AppSettings, "accentColor">>,
  ): AppSettings => ({
    apiToken: settings?.apiToken ?? "",
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    sessionFinishToastEnabled: settings?.sessionFinishToastEnabled ?? true,
    sessionFinishOsNotificationEnabled:
      settings?.sessionFinishOsNotificationEnabled ?? false,
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
    ...patch,
  });

  const setAccentColor = async (nextAccentColor: AccentColorId) => {
    applyAccentColor(nextAccentColor);
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings({ accentColor: nextAccentColor });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const next = await api.updateSettings({ accentColor: nextAccentColor });
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...next });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  return (
    <SettingsSection
      title="Theme"
      subtitle="Control the app accent color."
      headingLevel="h1"
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
                    border:
                      "1px solid color-mix(in srgb, var(--text) 26%, transparent)",
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
    </SettingsSection>
  );
}
