import { useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Icon } from "~/components/ui/Icon";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import {
  ACCENT_COLORS,
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
  type AccentColor,
  type AccentColorId,
} from "~/lib/accent-colors";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";

type ThemePreviewStyle = CSSProperties & Record<`--${string}`, string | number>;

export function ThemeSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const accentColor = settings?.accentColor ?? DEFAULT_ACCENT_COLOR;

  const optimisticSettings = (
    patch: Partial<Pick<AppSettings, "accentColor">>,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    sessionFinishToastEnabled: settings?.sessionFinishToastEnabled ?? true,
    sessionFinishOsNotificationEnabled:
      settings?.sessionFinishOsNotificationEnabled ?? false,
    launchAudioDisabled: settings?.launchAudioDisabled ?? false,
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
            gridTemplateColumns: "repeat(auto-fit, minmax(196px, 1fr))",
            gap: 14,
          }}
        >
          {ACCENT_COLORS.map((color) => (
            <ThemePreviewCard
              key={color.id}
              color={color}
              selected={color.id === accentColor}
              onSelect={() => setAccentColor(color.id)}
            />
          ))}
        </div>
      </Field>
    </SettingsSection>
  );
}

function ThemePreviewCard({
  color,
  selected,
  onSelect,
}: {
  color: AccentColor;
  selected: boolean;
  onSelect: () => void;
}) {
  const accentRgba = (a: number) => `rgba(${color.rgb}, ${a})`;
  const frameImage = selected ? `url("/borders/panel_focused.webp")` : `url("/borders/square.webp")`;
  return (
    <button
      type="button"
      className="theme-preview-card"
      onClick={onSelect}
      aria-pressed={selected}
      title={color.name}
      style={{
        "--theme-preview-accent-glow": accentRgba(selected ? 0.18 : 0.08),
        "--theme-preview-filter": color.filter,
        "--theme-preview-frame-image": frameImage,
        position: "relative",
        boxSizing: "border-box",
        padding: 0,
        cursor: "pointer",
        textAlign: "left",
        background: "transparent",
        borderStyle: "solid",
        borderColor: "transparent",
        borderWidth: 16,
        boxShadow: selected ? `0 0 22px ${accentRgba(0.35)}` : "none",
        transition: "box-shadow 0.15s",
        overflow: "hidden",
      } as ThemePreviewStyle}
    >
      {selected && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: color.value,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 10px ${accentRgba(0.6)}`,
          }}
        >
          <Icon name="check" size={11} />
        </span>
      )}
      <div
        style={{
          padding: "10px 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: color.value,
              border: "1px solid rgba(255, 255, 255, 0.15)",
              boxShadow: `0 0 12px ${accentRgba(0.55)}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              fontWeight: 600,
              color: selected ? "var(--text)" : "var(--text-dim)",
              letterSpacing: "-0.01em",
            }}
          >
            {color.name}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            aria-hidden
            className="theme-preview-action"
            style={{
              "--theme-preview-filter": color.filter,
              boxSizing: "border-box",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 600,
              color: "#fff",
              borderStyle: "solid",
              borderColor: "transparent",
              borderWidth: 12,
              position: "relative",
              backgroundColor: accentRgba(0.18),
              backgroundClip: "padding-box",
              textShadow: `0 0 8px ${accentRgba(0.6)}`,
            } as ThemePreviewStyle}
          >
            Action
          </span>
          <span
            aria-hidden
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: `linear-gradient(90deg, ${color.value}, ${accentRgba(0)})`,
              opacity: selected ? 1 : 0.6,
            }}
          />
        </div>
      </div>
    </button>
  );
}
