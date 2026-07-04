import { useId } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import { AccentColorGrid } from "~/components/views/AccentColorPicker";
import {
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
  type AccentColorId,
} from "~/lib/accent-colors";
import { api, type AppSettings } from "~/lib/api";
import { DEFAULT_THEME_STYLE, type ThemeStyle } from "~/shared/theme-style";
import { queryKeys, useSettings } from "~/queries";
import {
  hasCachedLaunchIntroPreference,
  readCachedLaunchIntroEnabled,
} from "~/lib/launch-intro";
import { DEFAULT_TERMINAL_ZOOM_LEVEL } from "~/shared/terminal-zoom";
import { emptyVoiceCommandAliases } from "~/shared/voice-command-aliases";

export function ThemeSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const accentColor = settings?.accentColor ?? DEFAULT_ACCENT_COLOR;
  const themeStyle = settings?.themeStyle ?? DEFAULT_THEME_STYLE;
  const minimalTheme = settings?.minimalTheme ?? false;
  const launchOverlayEnabled = typeof settings?.launchOverlayEnabled === "boolean"
    ? settings.launchOverlayEnabled
    : hasCachedLaunchIntroPreference()
      ? readCachedLaunchIntroEnabled()
      : false;

  const optimisticSettings = (
    patch: Partial<Pick<AppSettings, "accentColor" | "themeStyle" | "minimalTheme">>,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor,
    themeStyle,
    minimalTheme,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    sessionFinishToastEnabled: settings?.sessionFinishToastEnabled ?? true,
    sessionFinishOsNotificationEnabled:
      settings?.sessionFinishOsNotificationEnabled ?? false,
    notificationSoundEnabled: settings?.notificationSoundEnabled ?? true,
    launchOverlayEnabled,
    automaticUpdateDownloadsEnabled:
      settings?.automaticUpdateDownloadsEnabled ?? false,
    automaticUpdateInstallOnQuitEnabled:
      settings?.automaticUpdateInstallOnQuitEnabled ?? false,
    gitDiffChangedFilesView: settings?.gitDiffChangedFilesView ?? null,
    gitDiffChangedFilesWidth: settings?.gitDiffChangedFilesWidth ?? null,
    projectsDashboardView: settings?.projectsDashboardView ?? null,
    selectedWorktreeByProject: settings?.selectedWorktreeByProject ?? null,
    commitCli: settings?.commitCli ?? null,
    terminalZoomLevel: settings?.terminalZoomLevel ?? DEFAULT_TERMINAL_ZOOM_LEVEL,
    defaultAgent: settings?.defaultAgent ?? "claude-code",
    defaultModel: settings?.defaultModel ?? null,
    annotationAgent: settings?.annotationAgent ?? "claude-code",
    annotationModel: settings?.annotationModel ?? null,
    voiceCommandAliases: settings?.voiceCommandAliases ?? emptyVoiceCommandAliases(),
    voiceControlEnabled: settings?.voiceControlEnabled ?? false,
    claudeUsageLimitsEnabled: settings?.claudeUsageLimitsEnabled ?? false,
    claudeUsageLimitsShowSession: settings?.claudeUsageLimitsShowSession ?? true,
    claudeUsageLimitsShowWeekly: settings?.claudeUsageLimitsShowWeekly ?? true,
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
    worktreesEnabled:
      queryClient.getQueryData<AppSettings>(queryKeys.settings)?.worktreesEnabled ??
      settings?.worktreesEnabled ??
      false,
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

  const setThemeStyle = async (next: ThemeStyle) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    // Ember is built around its warm terracotta accent (sampled from the
    // reference) — default it out of the box; the user can still pick any
    // accent afterward and it sticks.
    const nextAccent =
      next === "ember" && accentColor !== "terracotta"
        ? ("terracotta" as AccentColorId)
        : accentColor;
    if (nextAccent !== accentColor) applyAccentColor(nextAccent);
    const optimistic = optimisticSettings({
      themeStyle: next,
      minimalTheme: next !== "painted",
      accentColor: nextAccent,
    });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const updated = await api.updateSettings(
        nextAccent !== accentColor
          ? { themeStyle: next, accentColor: nextAccent }
          : { themeStyle: next },
      );
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...updated });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  return (
    <SettingsSection
      title="Theme"
      subtitle="Pick the chrome Mission Control wears: painted pixel art, clean minimal, flat noir, or warm ember."
      headingLevel="h1"
    >
      <Field label="Theme style">
        <ThemeStyleToggle style={themeStyle} onChange={setThemeStyle} />
      </Field>
      <Field label="Accent color">
        <AccentColorGrid
          minimal={minimalTheme}
          selected={accentColor}
          onSelect={setAccentColor}
        />
      </Field>
    </SettingsSection>
  );
}

const THEME_STYLE_OPTIONS: Array<{
  value: ThemeStyle;
  label: string;
  description: string;
}> = [
  {
    value: "painted",
    label: "Painted",
    description: "Pixel-art borders and shell imagery. The full Mission Control look.",
  },
  {
    value: "minimal",
    label: "Minimal",
    description:
      "Clean CSS borders and textured cards. Lighter on the eyes, faster to render.",
  },
  {
    value: "noir",
    label: "Noir",
    description:
      "Flat near-black surfaces with hairline dividers. Borders only where they mean something.",
  },
  {
    value: "ember",
    label: "Ember",
    description:
      "Warm sepia near-black with edge-to-edge square panes and a clearer bundled mono. The focused session glows.",
  },
];

function ThemeStyleToggle({
  style,
  onChange,
}: {
  style: ThemeStyle;
  onChange: (next: ThemeStyle) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const active = THEME_STYLE_OPTIONS.find((option) => option.value === style)
    ?? THEME_STYLE_OPTIONS[0]!;
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
          {active.label}
        </div>
        <div
          id={descriptionId}
          style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}
        >
          {active.description}
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
        {THEME_STYLE_OPTIONS.map((option) => (
          <ModeOption
            key={option.value}
            label={option.label}
            selected={style === option.value}
            onSelect={() => onChange(option.value)}
          />
        ))}
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
