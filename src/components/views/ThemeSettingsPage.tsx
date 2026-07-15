import { DEFAULT_AGENT_LAUNCHER_CONFIG } from "~/shared/agent-launcher-config";
import { useId, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Field, SettingCard, SettingsSection } from "~/components/views/SettingsParts";
import { AccentColorGrid } from "~/components/views/AccentColorPicker";
import { ThemeStylePreview } from "~/components/views/ThemeStylePreview";
import { Icon } from "~/components/ui/Icon";
import {
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
  type AccentColorId,
} from "~/lib/accent-colors";
import { api, type AppSettings } from "~/lib/api";
import { DEFAULT_THEME_STYLE, type ThemeStyle } from "~/shared/theme-style";
import { DEFAULT_PET_HOME_SIDE } from "~/shared/pet";
import {
  DEFAULT_SURFACE_TINT,
  SURFACE_TINTS,
  type SurfaceTint,
} from "~/shared/surface-tint";
import { applySurfaceTint } from "~/lib/surface-tint";
import { useTheme, type Theme } from "~/lib/use-theme";
import { queryKeys, useSettings } from "~/queries";
import {
  hasCachedLaunchIntroPreference,
  readCachedLaunchIntroEnabled,
} from "~/lib/launch-intro";
import { DEFAULT_TERMINAL_ZOOM_LEVEL } from "~/shared/terminal-zoom";
import {
  DEFAULT_INTERFACE_FONT_SCALE,
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  DEFAULT_TERMINAL_LETTER_SPACING,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  INTERFACE_FONT_SCALES,
  type InterfaceFontScale,
} from "~/shared/terminal-appearance";
import {
  applyInterfaceFontFamily,
  applyInterfaceFontScale,
} from "~/lib/interface-appearance";
import {
  INTERFACE_FONT_CANDIDATES,
  useDetectedFonts,
} from "~/lib/font-detection";
import { emptyVoiceCommandAliases } from "~/shared/voice-command-aliases";
import { DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY } from "~/shared/session-header-buttons";
import { DEFAULT_SHIP_PROMPT } from "~/shared/ship-defaults";
import { DEFAULT_SYNC_PROMPT } from "~/shared/sync-defaults";

export function ThemeSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const { theme, set: setTheme } = useTheme();
  const accentColor = settings?.accentColor ?? DEFAULT_ACCENT_COLOR;
  const themeStyle = settings?.themeStyle ?? DEFAULT_THEME_STYLE;
  const surfaceTint = settings?.surfaceTint ?? DEFAULT_SURFACE_TINT;
  const minimalTheme = settings?.minimalTheme ?? false;
  const interfaceFontFamily = settings?.interfaceFontFamily ?? null;
  const interfaceFontScale =
    settings?.interfaceFontScale ?? DEFAULT_INTERFACE_FONT_SCALE;
  const detectedInterfaceFonts = useDetectedFonts(INTERFACE_FONT_CANDIDATES);
  // A stored family that's no longer installed still needs to appear selected.
  const strayInterfaceFamily =
    interfaceFontFamily && !detectedInterfaceFonts.includes(interfaceFontFamily)
      ? interfaceFontFamily
      : null;
  const launchOverlayEnabled = typeof settings?.launchOverlayEnabled === "boolean"
    ? settings.launchOverlayEnabled
    : hasCachedLaunchIntroPreference()
      ? readCachedLaunchIntroEnabled()
      : false;

  const optimisticSettings = (
    patch: Partial<
      Pick<
        AppSettings,
        | "accentColor"
        | "themeStyle"
        | "surfaceTint"
        | "minimalTheme"
        | "interfaceFontFamily"
        | "interfaceFontScale"
      >
    >,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor,
    themeStyle,
    surfaceTint,
    minimalTheme,
    // Every patch through here writes a theme setting, which marks it chosen.
    themeChosen: true,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    batterySaverEnabled: settings?.batterySaverEnabled ?? true,
    spellcheckEnabled: settings?.spellcheckEnabled ?? true,
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
    activeProjectGroup: settings?.activeProjectGroup ?? null,
    collapsedProjectGroups: settings?.collapsedProjectGroups ?? null,
    selectedWorktreeByProject: settings?.selectedWorktreeByProject ?? null,
    commitCli: settings?.commitCli ?? null,
    terminalZoomLevel: settings?.terminalZoomLevel ?? DEFAULT_TERMINAL_ZOOM_LEVEL,
    terminalFontFamily: settings?.terminalFontFamily ?? null,
    terminalFontWeight: settings?.terminalFontWeight ?? DEFAULT_TERMINAL_FONT_WEIGHT,
    terminalFontWeightBold:
      settings?.terminalFontWeightBold ?? DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
    terminalLineHeight: settings?.terminalLineHeight ?? DEFAULT_TERMINAL_LINE_HEIGHT,
    terminalLetterSpacing:
      settings?.terminalLetterSpacing ?? DEFAULT_TERMINAL_LETTER_SPACING,
    interfaceFontFamily: settings?.interfaceFontFamily ?? null,
    interfaceFontScale: settings?.interfaceFontScale ?? DEFAULT_INTERFACE_FONT_SCALE,
    sessionHeaderButtons:
      settings?.sessionHeaderButtons ?? DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY,
    defaultAgent: settings?.defaultAgent ?? "claude-code",
    defaultModel: settings?.defaultModel ?? null,
    annotationAgent: settings?.annotationAgent ?? "claude-code",
    annotationModel: settings?.annotationModel ?? null,
    shipAgent: settings?.shipAgent ?? "claude-code",
    shipModel: settings?.shipModel ?? null,
    shipPrompt: settings?.shipPrompt ?? DEFAULT_SHIP_PROMPT,
    syncAgent: settings?.syncAgent ?? "claude-code",
    syncModel: settings?.syncModel ?? null,
    syncPrompt: settings?.syncPrompt ?? DEFAULT_SYNC_PROMPT,
    voiceCommandAliases: settings?.voiceCommandAliases ?? emptyVoiceCommandAliases(),
    voiceControlEnabled: settings?.voiceControlEnabled ?? false,
    questionOverlayEnabled: settings?.questionOverlayEnabled ?? true,
    claudeUsageLimitsEnabled: settings?.claudeUsageLimitsEnabled ?? false,
    claudeUsageLimitsShowSession: settings?.claudeUsageLimitsShowSession ?? true,
    claudeUsageLimitsShowWeekly: settings?.claudeUsageLimitsShowWeekly ?? true,
    providerUsageEnabled: settings?.providerUsageEnabled ?? false,
    providerUsageIds: settings?.providerUsageIds ?? ["claude", "codex", "cursor"],
    agentLauncherConfig: settings?.agentLauncherConfig ?? DEFAULT_AGENT_LAUNCHER_CONFIG,
    recallEnabled: settings?.recallEnabled ?? false,
    recallAutoCaptureEnabled: settings?.recallAutoCaptureEnabled ?? true,
    recallEngineEnabled: settings?.recallEngineEnabled ?? true,
    recallEngineHarness: settings?.recallEngineHarness ?? "claude-code",
    recallEngineModel: settings?.recallEngineModel ?? null,
    recallAgentWriteEnabled: settings?.recallAgentWriteEnabled ?? true,
    recallInjectBriefEnabled: settings?.recallInjectBriefEnabled ?? true,
    recallCodeGraphEnabled: settings?.recallCodeGraphEnabled ?? true,
    recallProactiveRecallEnabled: settings?.recallProactiveRecallEnabled ?? true,
    recallLearnedToastEnabled: settings?.recallLearnedToastEnabled ?? true,
    petEnabled: settings?.petEnabled ?? true,
    petMessagesEnabled: settings?.petMessagesEnabled ?? true,
    petSoundsEnabled: settings?.petSoundsEnabled ?? false,
    petMultiplayerEnabled: settings?.petMultiplayerEnabled ?? false,
    petHomeSide: settings?.petHomeSide ?? DEFAULT_PET_HOME_SIDE,
    petState: settings?.petState ?? null,
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
    worktreesEnabled: true,
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
    // The flat theme is built around its warm terracotta accent (sampled from
    // the reference) — default it out of the box; the user can still pick any
    // accent afterward and it sticks.
    const nextAccent =
      next === "flat" && accentColor !== "terracotta"
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

  const setSurfaceTint = async (next: SurfaceTint) => {
    applySurfaceTint(next);
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings({ surfaceTint: next });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const updated = await api.updateSettings({ surfaceTint: next });
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...updated });
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(queryKeys.settings, previous);
        applySurfaceTint(previous.surfaceTint ?? DEFAULT_SURFACE_TINT);
      }
      throw error;
    }
  };

  const setInterfaceFontFamily = async (next: string | null) => {
    applyInterfaceFontFamily(next);
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings({ interfaceFontFamily: next });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const updated = await api.updateSettings({ interfaceFontFamily: next });
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...updated });
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(queryKeys.settings, previous);
        applyInterfaceFontFamily(previous.interfaceFontFamily ?? null);
      }
      throw error;
    }
  };

  const setInterfaceFontScale = async (next: InterfaceFontScale) => {
    applyInterfaceFontScale(next);
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings({ interfaceFontScale: next });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const updated = await api.updateSettings({ interfaceFontScale: next });
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...updated });
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(queryKeys.settings, previous);
        applyInterfaceFontScale(
          previous.interfaceFontScale ?? DEFAULT_INTERFACE_FONT_SCALE,
        );
      }
      throw error;
    }
  };

  return (
    <SettingsSection
      title="Theme"
      subtitle="Pick the chrome Mission Control wears: painted pixel art or the warm, flat Ember look — the latter in dark or light."
      headingLevel="h1"
    >
      <Field label="Theme style">
        <ThemeStyleGrid
          style={themeStyle}
          accentColor={accentColor}
          surfaceTint={surfaceTint}
          theme={theme}
          onChange={setThemeStyle}
        />
      </Field>
      {themeStyle === "flat" && (
        <Field label="Appearance">
          <DarkLightToggle theme={theme} onChange={setTheme} />
        </Field>
      )}
      <Field label="Accent color">
        <AccentColorGrid
          minimal={minimalTheme}
          selected={accentColor}
          onSelect={setAccentColor}
        />
      </Field>
      <Field label="Surface tint">
        <SurfaceTintToggle tint={surfaceTint} onChange={setSurfaceTint} />
      </Field>
      <SettingCard
        title="Interface font family"
        description="Used for the application UI. Pulls from fonts installed on your system; terminal text is configured on the Terminal tab."
      >
        <select
          value={interfaceFontFamily ?? ""}
          aria-label="Interface font family"
          className="term-select"
          onChange={(event) => {
            const value = event.target.value;
            void setInterfaceFontFamily(value === "" ? null : value);
          }}
          style={{
            width: "100%",
            maxWidth: 440,
            padding: "9px 10px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--surface-1)",
            color: "var(--text)",
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
        >
          <option value="">Theme default</option>
          {strayInterfaceFamily && (
            <option value={strayInterfaceFamily}>
              {strayInterfaceFamily} (not found)
            </option>
          )}
          {detectedInterfaceFonts.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>
      </SettingCard>
      <SettingCard
        title="Interface font scale"
        description={`Adjusts the size of all UI elements. Currently ${Math.round(
          interfaceFontScale * 100,
        )}%.`}
      >
        <InterfaceScaleRow scale={interfaceFontScale} onChange={setInterfaceFontScale} />
      </SettingCard>
    </SettingsSection>
  );
}

function InterfaceScaleRow({
  scale,
  onChange,
}: {
  scale: InterfaceFontScale;
  onChange: (next: InterfaceFontScale) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Interface font scale"
      style={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}
    >
      {INTERFACE_FONT_SCALES.map((candidate, index) => {
        const selected = candidate === scale;
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${Math.round(candidate * 100)}%`}
            title={`${Math.round(candidate * 100)}%`}
            onClick={() => onChange(candidate)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: selected
                ? "2px solid var(--accent)"
                : "2px solid transparent",
              color: selected ? "var(--accent)" : "var(--text-dim)",
              fontFamily: "var(--sans)",
              // The glyph itself communicates the step, like a type-size ramp.
              fontSize: 10 + index * 1.5,
              fontWeight: selected ? 700 : 500,
              padding: "3px 7px 2px",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            A
          </button>
        );
      })}
    </div>
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
    description: "Pixel-art borders and shell imagery. The full Mission Control look. Dark only.",
  },
  {
    value: "flat",
    label: "Flat",
    description:
      "Warm sepia near-black with edge-to-edge square panes and a clearer bundled mono. The focused session glows. Supports dark and light.",
  },
];

function ThemeStyleGrid({
  style,
  accentColor,
  surfaceTint,
  theme,
  onChange,
}: {
  style: ThemeStyle;
  accentColor: AccentColorId;
  surfaceTint: SurfaceTint;
  theme: Theme;
  onChange: (next: ThemeStyle) => void;
}) {
  const labelId = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      style={{
        display: "grid",
        // Cap card width so the 16:10 previews stay thumbnail-sized on wide
        // windows instead of stretching to fill the settings column.
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 280px))",
        gap: 12,
      }}
    >
      <span id={labelId} style={{ display: "none" }}>
        Theme style
      </span>
      {THEME_STYLE_OPTIONS.map((option) => {
        const selected = style === option.value;
        const isPainted = option.value === "painted";
        // The painted card always wears dark pixel-art chrome — even while the
        // app is in light mode (painted is dark-only) — so its labels take fixed
        // light-on-dark ink rather than the theme's --text, which would be
        // near-black and unreadable on the dark frame. The flat card's chrome
        // follows the theme, so its labels use the theme vars.
        const labelColor = isPainted
          ? selected
            ? "#e8e6df"
            : "rgba(232, 230, 223, 0.6)"
          : selected
            ? "var(--text)"
            : "var(--text-dim)";
        const descColor = isPainted
          ? "rgba(232, 230, 223, 0.4)"
          : "var(--text-faint)";
        // Each card wears its own theme's chrome: the painted card gets the
        // pixel-art panel frame (the CardFrame recipe, inlined so the
        // [data-minimal] flattening rules can't strip it when the flat theme
        // is active), the flat card stays a hairline surface.
        const paintedFrame = selected
          ? "var(--mc-panel-focused-image)"
          : "var(--mc-panel-image)";
        const cardChrome: CSSProperties =
          option.value === "painted"
            ? {
                // 16px frame + 0 padding = same 16px content inset as the
                // flat card (1px border + 15px padding), so both previews
                // render at the same size.
                padding: 0,
                backgroundColor: "transparent",
                backgroundClip: "padding-box",
                backgroundImage: `linear-gradient(rgba(3, 6, 8, 0.15), rgba(3, 6, 8, 0.15)), ${paintedFrame}`,
                backgroundPosition: "0% 0%, 39.0625% 39.0625%",
                backgroundSize: "auto, 200% 200%",
                backgroundRepeat: "repeat, no-repeat",
                borderStyle: "solid",
                borderColor: "transparent",
                borderWidth: 16,
                borderImageSource: paintedFrame,
                borderImageSlice: 48,
                borderImageWidth: "16px",
                borderImageRepeat: "stretch",
                borderRadius: 0,
              }
            : {
                padding: 15,
                background: "var(--surface-1)",
                border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--mm-radius-lg, 10px)",
                boxShadow: selected ? "0 0 0 1px var(--accent) inset" : "none",
              };
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className="mc-swatch-card"
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              cursor: "pointer",
              textAlign: "left",
              ...cardChrome,
            }}
          >
            {selected && (
              <span
                aria-hidden
                className="mc-check-pop"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  zIndex: 1,
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: "var(--accent)",
                  color: "var(--mm-on-accent, #fff)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="check" size={11} />
              </span>
            )}
            <ThemeStylePreview
              style={option.value}
              accentId={accentColor}
              tint={surfaceTint}
              theme={theme}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: labelColor,
                }}
              >
                {option.label}
              </span>
              <span
                style={{ fontSize: 11.5, lineHeight: 1.45, color: descColor }}
              >
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const DARK_LIGHT_OPTIONS: Record<Theme, { label: string; description: string }> = {
  dark: { label: "Dark", description: "Deep near-black ground — the default." },
  light: { label: "Light", description: "Clean white surfaces for bright rooms." },
};

/** Dark/light switch — only rendered for the flat theme (painted is dark-only).
 *  Preference lives in localStorage via useTheme, not server settings. */
function DarkLightToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (next: Theme) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const active = DARK_LIGHT_OPTIONS[theme];
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
          style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}
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
        {(["dark", "light"] as const).map((value) => (
          <ModeOption
            key={value}
            label={DARK_LIGHT_OPTIONS[value].label}
            selected={theme === value}
            onSelect={() => onChange(value)}
          />
        ))}
      </div>
    </div>
  );
}

const SURFACE_TINT_OPTIONS: Record<SurfaceTint, { label: string; description: string }> = {
  off: {
    label: "Off",
    description: "Surfaces keep each style's exact base palette.",
  },
  subtle: {
    label: "Subtle",
    description: "A whisper of your accent in backgrounds, bars and sessions.",
  },
  vivid: {
    label: "Vivid",
    description: "A clearly visible accent wash across the whole app.",
  },
  intense: {
    label: "Intense",
    description:
      "Warm-charcoal ground — the old Ember look. Best on a warm accent like Terracotta.",
  },
};

function SurfaceTintToggle({
  tint,
  onChange,
}: {
  tint: SurfaceTint;
  onChange: (next: SurfaceTint) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const active = SURFACE_TINT_OPTIONS[tint];
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
        {SURFACE_TINTS.map((value) => (
          <ModeOption
            key={value}
            label={SURFACE_TINT_OPTIONS[value].label}
            selected={tint === value}
            onSelect={() => onChange(value)}
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
      className="mc-mode-option"
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
        color: selected ? "var(--accent-ink)" : "var(--text-dim)",
      }}
    >
      {label}
    </button>
  );
}
