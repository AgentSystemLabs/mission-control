import { DEFAULT_AGENT_LAUNCHER_CONFIG } from "~/shared/agent-launcher-config";
import { useQueryClient } from "@tanstack/react-query";
import { SettingCard, SettingsSection, ValueRow } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import { DEFAULT_ACCENT_COLOR } from "~/lib/accent-colors";
import { TERMINAL_FONT_FAMILY } from "~/lib/terminal-options";
import { terminalFontStack } from "~/lib/terminal-appearance";
import { DEFAULT_PET_HOME_SIDE } from "~/shared/pet";
import {
  BUNDLED_TERMINAL_FONTS,
  SYSTEM_MONO_FONT_CANDIDATES,
  useDetectedFonts,
} from "~/lib/font-detection";
import {
  DEFAULT_TERMINAL_ZOOM_LEVEL,
  TERMINAL_ZOOM_LABELS,
  TERMINAL_ZOOM_LEVELS,
  TERMINAL_ZOOM_MAX,
  TERMINAL_ZOOM_MIN,
  terminalFontSizeForLevel,
  type TerminalZoomLevel,
} from "~/shared/terminal-zoom";
import {
  DEFAULT_INTERFACE_FONT_SCALE,
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  DEFAULT_TERMINAL_LETTER_SPACING,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  TERMINAL_FONT_WEIGHTS,
  TERMINAL_LETTER_SPACINGS,
  TERMINAL_LINE_HEIGHTS,
} from "~/shared/terminal-appearance";
import { emptyVoiceCommandAliases } from "~/shared/voice-command-aliases";
import { DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY } from "~/shared/session-header-buttons";
import { DEFAULT_SURFACE_TINT } from "~/shared/surface-tint";
import { DEFAULT_SHIP_PROMPT } from "~/shared/ship-defaults";
import { DEFAULT_SYNC_PROMPT } from "~/shared/sync-defaults";

type AppearancePatch = Partial<
  Pick<
    AppSettings,
    | "terminalZoomLevel"
    | "terminalFontFamily"
    | "terminalFontWeight"
    | "terminalFontWeightBold"
    | "terminalLineHeight"
    | "terminalLetterSpacing"
  >
>;

function TerminalPreview({
  fontFamily,
  fontSize,
  fontWeight,
  fontWeightBold,
  lineHeight,
  letterSpacing,
}: {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontWeightBold: number;
  lineHeight: number;
  letterSpacing: number;
}) {
  const bold = { fontWeight: fontWeightBold };
  const dim = { color: "var(--text-dim)" };
  const prompt = <span style={{ color: "var(--accent)" }}>$</span>;
  return (
    <div
      aria-hidden
      style={{
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--text-dim)",
          textAlign: "center",
        }}
      >
        Live preview
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          background: "var(--terminal-bg, #050607)",
          color: "var(--text)",
          fontFamily,
          fontSize,
          fontWeight,
          lineHeight,
          letterSpacing,
          overflowX: "auto",
        }}
      >
        {prompt} <span style={bold}>font-check</span> --sample{"\n"}
        AaBbCc 1234567890 il1I O0 [] {"{}"} () {"<>"} !@#$%^&*{"\n"}
        agjpqy AGJPQY _-+=|/:;,.?~{"\n"}
        {"\n"}
        {prompt} <span style={bold}>cargo test</span>
        {"\n"}
        test result: <span style={{ color: "var(--ok, #099250)", ...bold }}>ok</span>. 847
        passed; 0 failed; finished in 0.8s{"\n"}
        <span style={dim}>12:34:56</span>{" "}
        <span style={{ color: "#2e90fa", ...bold }}>INFO</span>{" "}
        <span style={dim}>worker</span> started build pipeline{"\n"}
        <span style={dim}>12:34:57</span>{" "}
        <span style={{ color: "#c07213", ...bold }}>WARN</span>{" "}
        <span style={dim}>worker</span> retrying in 250ms{"\n"}
        <span style={dim}>12:34:58</span>{" "}
        <span style={{ color: "#2e90fa", ...bold }}>INFO</span>{" "}
        <span style={dim}>worker</span> build complete{"\n"}
        {prompt} <span style={bold}>git push</span>
        {"\n"}
        Everything up-to-date{"\n"}
        {prompt}{" "}
        <span
          style={{
            display: "inline-block",
            width: "0.6em",
            height: "1em",
            verticalAlign: "text-bottom",
            background: "var(--accent)",
          }}
        />
      </pre>
    </div>
  );
}

export function TerminalSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const level = settings?.terminalZoomLevel ?? DEFAULT_TERMINAL_ZOOM_LEVEL;
  const fontSize = terminalFontSizeForLevel(level);
  const fontFamily = settings?.terminalFontFamily ?? null;
  const fontWeight = settings?.terminalFontWeight ?? DEFAULT_TERMINAL_FONT_WEIGHT;
  const fontWeightBold =
    settings?.terminalFontWeightBold ?? DEFAULT_TERMINAL_FONT_WEIGHT_BOLD;
  const lineHeight = settings?.terminalLineHeight ?? DEFAULT_TERMINAL_LINE_HEIGHT;
  const letterSpacing =
    settings?.terminalLetterSpacing ?? DEFAULT_TERMINAL_LETTER_SPACING;

  const detectedFonts = useDetectedFonts(SYSTEM_MONO_FONT_CANDIDATES);
  const systemFonts = detectedFonts.filter(
    (family) => !(BUNDLED_TERMINAL_FONTS as readonly string[]).includes(family),
  );
  // A stored family that's no longer installed still needs to appear selected.
  const strayFamily =
    fontFamily &&
    !(BUNDLED_TERMINAL_FONTS as readonly string[]).includes(fontFamily) &&
    !systemFonts.includes(fontFamily)
      ? fontFamily
      : null;

  const optimisticSettings = (patch: AppearancePatch): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor: settings?.accentColor ?? DEFAULT_ACCENT_COLOR,
    themeStyle: settings?.themeStyle ?? "painted",
    surfaceTint: settings?.surfaceTint ?? DEFAULT_SURFACE_TINT,
    backgroundImage: settings?.backgroundImage ?? null,
    minimalTheme: settings?.minimalTheme ?? false,
    themeChosen: settings?.themeChosen ?? false,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    batterySaverEnabled: settings?.batterySaverEnabled ?? true,
    spellcheckEnabled: settings?.spellcheckEnabled ?? true,
    sessionFinishToastEnabled: settings?.sessionFinishToastEnabled ?? true,
    sessionFinishOsNotificationEnabled:
      settings?.sessionFinishOsNotificationEnabled ?? false,
    notificationSoundEnabled: settings?.notificationSoundEnabled ?? true,
    launchOverlayEnabled: settings?.launchOverlayEnabled ?? false,
    automaticUpdateDownloadsEnabled: settings?.automaticUpdateDownloadsEnabled ?? false,
    automaticUpdateInstallOnQuitEnabled:
      settings?.automaticUpdateInstallOnQuitEnabled ?? false,
    worktreesEnabled: true,
    gitDiffChangedFilesView: settings?.gitDiffChangedFilesView ?? null,
    gitDiffChangedFilesWidth: settings?.gitDiffChangedFilesWidth ?? null,
    projectsDashboardView: settings?.projectsDashboardView ?? null,
    activeProjectGroup: settings?.activeProjectGroup ?? null,
    collapsedProjectGroups: settings?.collapsedProjectGroups ?? null,
    selectedWorktreeByProject: settings?.selectedWorktreeByProject ?? null,
    commitCli: settings?.commitCli ?? null,
    terminalZoomLevel: level,
    terminalFontFamily: fontFamily,
    terminalFontWeight: fontWeight,
    terminalFontWeightBold: fontWeightBold,
    terminalLineHeight: lineHeight,
    terminalLetterSpacing: letterSpacing,
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
    ...patch,
  });

  const save = async (patch: AppearancePatch) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings(patch);
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const updated = await api.updateSettings(patch);
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...updated });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  const previewFontFamily = fontFamily
    ? terminalFontStack(fontFamily)
    : `var(--mc-terminal-font, ${TERMINAL_FONT_FAMILY})`;

  return (
    <SettingsSection
      title="Terminal"
      subtitle="Typography for every terminal pane. Changes apply live to open sessions."
      headingLevel="h1"
    >
      <div className="term-settings-shell">
        <div className="term-settings">
          <div className="term-settings__controls">
            <SettingCard
              title="Font family"
              description="Bundled faces plus monospace fonts detected on your system. Theme default follows the active theme’s bundled face."
            >
              <select
                value={fontFamily ?? ""}
                aria-label="Terminal font family"
                className="term-select"
                onChange={(event) => {
                  const value = event.target.value;
                  void save({ terminalFontFamily: value === "" ? null : value });
                }}
                style={{
                  width: "100%",
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
                <optgroup label="Bundled">
                  {BUNDLED_TERMINAL_FONTS.map((family) => (
                    <option key={family} value={family}>
                      {family}
                    </option>
                  ))}
                </optgroup>
                {(systemFonts.length > 0 || strayFamily) && (
                  <optgroup label="Installed on this Mac">
                    {strayFamily && (
                      <option value={strayFamily}>{strayFamily} (not found)</option>
                    )}
                    {systemFonts.map((family) => (
                      <option key={family} value={family}>
                        {family}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </SettingCard>

            <SettingCard
              title="Font weight"
              description="Weight for regular text, and for bold runs like prompts and highlights."
            >
              <div className="term-weight">
                <div className="term-weight__row">
                  <span className="term-weight__key">Regular</span>
                  <ValueRow
                    values={TERMINAL_FONT_WEIGHTS}
                    value={fontWeight}
                    onSelect={(next) => void save({ terminalFontWeight: next })}
                    ariaLabel="Weight for regular terminal text"
                  />
                </div>
                <div className="term-weight__row">
                  <span className="term-weight__key">Bold</span>
                  <ValueRow
                    values={TERMINAL_FONT_WEIGHTS}
                    value={fontWeightBold}
                    onSelect={(next) => void save({ terminalFontWeightBold: next })}
                    ariaLabel="Weight for bold terminal text"
                  />
                </div>
              </div>
            </SettingCard>

            <SettingCard
              title="Default zoom"
              description="Starting size for every terminal, until you zoom a pane from its header. Per-pane zoom is remembered separately."
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    color: "var(--text)",
                  }}
                >
                  <span>{TERMINAL_ZOOM_LABELS[level]}</span>
                  <span style={{ color: "var(--text-dim)" }}>{fontSize}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={TERMINAL_ZOOM_LEVELS.length - 1}
                  step={1}
                  value={TERMINAL_ZOOM_LEVELS.indexOf(level)}
                  onChange={(event) => {
                    const index = Number(event.currentTarget.value);
                    const next = TERMINAL_ZOOM_LEVELS[index];
                    if (next !== undefined)
                      void save({ terminalZoomLevel: next as TerminalZoomLevel });
                  }}
                  aria-label="Default terminal zoom level"
                  aria-valuemin={TERMINAL_ZOOM_MIN}
                  aria-valuemax={TERMINAL_ZOOM_MAX}
                  aria-valuenow={level}
                  aria-valuetext={TERMINAL_ZOOM_LABELS[level]}
                  style={{
                    width: "100%",
                    accentColor: "var(--accent)",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--text-faint)",
                  }}
                >
                  {TERMINAL_ZOOM_LEVELS.map((step) => (
                    <span key={step}>{step > 0 ? `+${step}` : step}</span>
                  ))}
                </div>
              </div>
            </SettingCard>

            <SettingCard
              title="Line height"
              description="1.0 keeps box drawing and ANSI art flush; higher adds breathing room."
            >
              <ValueRow
                values={TERMINAL_LINE_HEIGHTS}
                value={lineHeight}
                onSelect={(next) => void save({ terminalLineHeight: next })}
                format={(v) => v.toFixed(1)}
                ariaLabel="Spacing between terminal lines"
              />
            </SettingCard>

            <SettingCard
              title="Letter spacing"
              description="Extra horizontal space between characters, in pixels."
            >
              <ValueRow
                values={TERMINAL_LETTER_SPACINGS}
                value={letterSpacing}
                onSelect={(next) => void save({ terminalLetterSpacing: next })}
                format={(v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
                ariaLabel="Extra pixels between terminal characters"
              />
            </SettingCard>
          </div>

          <aside className="term-settings__preview">
            <TerminalPreview
              fontFamily={previewFontFamily}
              fontSize={fontSize}
              fontWeight={fontWeight}
              fontWeightBold={fontWeightBold}
              lineHeight={lineHeight}
              letterSpacing={letterSpacing}
            />
          </aside>
        </div>
      </div>
    </SettingsSection>
  );
}
