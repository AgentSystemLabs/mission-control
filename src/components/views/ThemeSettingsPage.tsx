import { useId } from "react";
import { useQueryClient } from "@tanstack/react-query";
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

// Pixel size of the color-swatch dot used in the accent-color picker (both
// the selected-check badge and the per-row preview swatch use this size).
const SWATCH_DOT_PX = 18;

export function ThemeSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const accentColor = settings?.accentColor ?? DEFAULT_ACCENT_COLOR;
  const minimalTheme = settings?.minimalTheme ?? false;

  const optimisticSettings = (
    patch: Partial<Pick<AppSettings, "accentColor" | "minimalTheme">>,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor,
    minimalTheme,
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

  const setMinimalTheme = async (next: boolean) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings({ minimalTheme: next });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const updated = await api.updateSettings({ minimalTheme: next });
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...updated });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  return (
    <SettingsSection
      title="Theme"
      subtitle="Choose between the pixel-art chrome and a clean, minimal look."
      headingLevel="h1"
    >
      <Field label="Theme style">
        <ThemeModeToggle minimal={minimalTheme} onChange={setMinimalTheme} />
      </Field>
      <Field label="Accent color">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(196px, 1fr))",
            gap: 14,
          }}
        >
          {ACCENT_COLORS.map((color) =>
            minimalTheme ? (
              <MinimalThemeCard
                key={color.id}
                color={color}
                selected={color.id === accentColor}
                onSelect={() => setAccentColor(color.id)}
              />
            ) : (
              <ThemePreviewCard
                key={color.id}
                color={color}
                selected={color.id === accentColor}
                onSelect={() => setAccentColor(color.id)}
              />
            ),
          )}
        </div>
      </Field>
    </SettingsSection>
  );
}

function ThemeModeToggle({
  minimal,
  onChange,
}: {
  minimal: boolean;
  onChange: (next: boolean) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 14px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: "var(--mm-radius, 7px)",
      }}
    >
      <div>
        <div
          id={titleId}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 3,
          }}
        >
          Minimal theme
        </div>
        <div
          id={descriptionId}
          style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}
        >
          Replace the painted borders and shell imagery with clean CSS borders.
          Lighter on the eyes, faster to render.
        </div>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        style={{
          display: "inline-flex",
          padding: 2,
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: "var(--mm-radius, 7px)",
          flexShrink: 0,
        }}
      >
        <ModeOption
          label="Painted"
          selected={!minimal}
          onSelect={() => onChange(false)}
        />
        <ModeOption
          label="Minimal"
          selected={minimal}
          onSelect={() => onChange(true)}
        />
      </div>
    </div>
  );
}

function ModeOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={{
        padding: "6px 12px",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        border: 0,
        borderRadius: "var(--mm-radius-sm, 5px)",
        cursor: "pointer",
        background: selected ? "var(--accent-dim)" : "transparent",
        color: selected ? "var(--accent)" : "var(--text-dim)",
        transition: "background 0.12s ease, color 0.12s ease",
      }}
    >
      {label}
    </button>
  );
}

function MinimalThemeCard({
  color,
  selected,
  onSelect,
}: {
  color: AccentColor;
  selected: boolean;
  onSelect: () => void;
}) {
  const accentRgba = (a: number) => `rgba(${color.rgb}, ${a})`;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={color.name}
      style={{
        position: "relative",
        boxSizing: "border-box",
        padding: 14,
        cursor: "pointer",
        textAlign: "left",
        background: "var(--surface-1)",
        border: `1px solid ${selected ? color.value : "var(--border)"}`,
        borderRadius: "var(--mm-radius-lg, 10px)",
        boxShadow: selected ? `0 0 0 1px ${color.value} inset` : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {selected && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: SWATCH_DOT_PX,
            height: SWATCH_DOT_PX,
            borderRadius: 999,
            background: color.value,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={11} />
        </span>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: SWATCH_DOT_PX,
              height: SWATCH_DOT_PX,
              borderRadius: 999,
              background: color.value,
              border: "1px solid rgba(255, 255, 255, 0.15)",
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 600,
              color: "#fff",
              borderRadius: "var(--mm-radius-sm, 5px)",
              background: color.value,
            }}
          >
            Action
          </span>
          <span
            aria-hidden
            style={{
              flex: 1,
              height: 4,
              borderRadius: "var(--mm-radius-sm, 2px)",
              background: `linear-gradient(90deg, ${color.value}, ${accentRgba(0)})`,
              opacity: selected ? 1 : 0.6,
            }}
          />
        </div>
      </div>
    </button>
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
  const panelBorder = `url("/borders/panel_focused_${color.id}.png")`;
  const squareBorder = `url("/borders/square_${color.id}.png")`;
  const buttonBorder = `url("/borders/button_filled_${color.id}.png")`;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={color.name}
      style={{
        position: "relative",
        boxSizing: "border-box",
        padding: 0,
        cursor: "pointer",
        textAlign: "left",
        background:
          `linear-gradient(rgba(3, 6, 8, 0.30), rgba(3, 6, 8, 0.30)), ` +
          `radial-gradient(circle at 30% 0%, ${accentRgba(selected ? 0.18 : 0.08)}, transparent 65%), ` +
          `${selected ? panelBorder : squareBorder} 39.0625% 39.0625% / 200% 200% no-repeat`,
        backgroundClip: "padding-box",
        borderStyle: "solid",
        borderColor: "transparent",
        borderWidth: 16,
        borderImageSource: selected
          ? panelBorder
          : squareBorder,
        borderImageSlice: "48",
        borderImageWidth: "16px",
        borderImageRepeat: "stretch",
        boxShadow: selected ? `0 0 22px ${accentRgba(0.35)}` : "none",
        transition: "box-shadow 0.15s",
        overflow: "hidden",
      }}
    >
      {selected && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: SWATCH_DOT_PX,
            height: SWATCH_DOT_PX,
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
              width: SWATCH_DOT_PX,
              height: SWATCH_DOT_PX,
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
            style={{
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
              borderImageSource: buttonBorder,
              borderImageSlice: "48",
              borderImageWidth: "12px",
              borderImageRepeat: "stretch",
              background: accentRgba(0.18),
              backgroundClip: "padding-box",
              textShadow: `0 0 8px ${accentRgba(0.6)}`,
            }}
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
