import { z } from "zod";
import {
  deleteSetting,
  getBooleanSetting,
  getSetting,
  setBooleanSetting,
  setSetting,
} from "../services/settings";
import {
  DEFAULT_ACCENT_COLOR,
  isAccentColorId,
  type AccentColorId,
} from "~/lib/accent-colors";
import {
  COMMIT_CLI_VALUES,
  isCommitCli,
  type CommitCli,
} from "~/shared/commit-cli";
import {
  AI_MODEL_ID_HELP,
  AI_RUNTIME_HARNESS_VALUES,
  isAiRuntimeHarness,
  normalizeAiModelId,
  type AiModelId,
  type AiRuntimeHarness,
} from "~/shared/ai-runtime-defaults";
import {
  GIT_DIFF_CHANGED_FILES_VIEWS,
  GIT_DIFF_CHANGED_FILES_WIDTH_MAX,
  GIT_DIFF_CHANGED_FILES_WIDTH_MIN,
  PROJECTS_DASHBOARD_VIEWS,
  normalizeGitDiffChangedFilesView,
  normalizeGitDiffChangedFilesWidth,
  normalizeProjectsDashboardView,
  normalizeSelectedWorktreeByProject,
} from "~/shared/ui-preferences";
import { safeJsonParse } from "~/shared/safe-json";
import {
  isThemeStyle,
  normalizeThemeStyle,
  type ThemeStyle,
} from "~/shared/theme-style";
import {
  DEFAULT_SURFACE_TINT,
  isSurfaceTint,
  type SurfaceTint,
} from "~/shared/surface-tint";
import {
  DEFAULT_PROVIDER_USAGE_IDS,
  normalizeProviderUsageIds,
  type ProviderUsageId,
} from "~/shared/provider-usage";
import {
  normalizeAgentLauncherConfig,
  type AgentLauncherConfig,
} from "~/shared/agent-launcher-config";
import {
  DEFAULT_TERMINAL_ZOOM_LEVEL,
  TERMINAL_ZOOM_MAX,
  TERMINAL_ZOOM_MIN,
  normalizeTerminalZoomLevel,
} from "~/shared/terminal-zoom";
import {
  DEFAULT_INTERFACE_FONT_SCALE,
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  FONT_FAMILY_MAX_LENGTH,
  INTERFACE_FONT_SCALES,
  TERMINAL_FONT_WEIGHTS,
  TERMINAL_LETTER_SPACINGS,
  TERMINAL_LINE_HEIGHTS,
  normalizeFontFamily,
  normalizeInterfaceFontScale,
  normalizeTerminalFontWeight,
  normalizeTerminalLetterSpacing,
  normalizeTerminalLineHeight,
} from "~/shared/terminal-appearance";
import {
  emptyVoiceCommandAliases,
  normalizeVoiceCommandAliases,
  type VoiceCommandAliases,
} from "~/shared/voice-command-aliases";
import {
  normalizeSessionHeaderButtonVisibility,
  type SessionHeaderButtonVisibility,
} from "~/shared/session-header-buttons";
import { readRecallSettings, writeRecallSettings } from "../services/recall-settings";
import { DEFAULT_SHIP_PROMPT, normalizeShipPrompt } from "~/shared/ship-defaults";
import { mergePetStateWrite, normalizePetState } from "~/shared/pet";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";
import { json, jsonError, parseJsonBody } from "./_helpers";

const COMMIT_CLI_SETTING_KEY = "commit_cli";
const DEFAULT_AGENT_SETTING_KEY = "default_agent";
const DEFAULT_MODEL_SETTING_KEY = "default_model";
const ANNOTATION_AGENT_SETTING_KEY = "annotation_agent";
const ANNOTATION_MODEL_SETTING_KEY = "annotation_model";
const SHIP_AGENT_SETTING_KEY = "ship_agent";
const SHIP_MODEL_SETTING_KEY = "ship_model";
const SHIP_PROMPT_SETTING_KEY = "ship_prompt";
const GIT_DIFF_CHANGED_FILES_VIEW_KEY = "git_diff_changed_files_view";
const GIT_DIFF_CHANGED_FILES_WIDTH_KEY = "git_diff_changed_files_width";
const SELECTED_WORKTREE_BY_PROJECT_KEY = "selected_worktree_by_project";
const PROJECTS_DASHBOARD_VIEW_KEY = "projects_dashboard_view";
const TERMINAL_ZOOM_LEVEL_KEY = "terminal_zoom_level";
const SESSION_HEADER_BUTTONS_KEY = "session_header_buttons";
const THEME_STYLE_KEY = "theme_style";
const MINIMAL_THEME_KEY = "minimal_theme";
const SURFACE_TINT_KEY = "surface_tint";
const VOICE_COMMAND_ALIASES_KEY = "voice_command_aliases";
const CLAUDE_USAGE_LIMITS_ENABLED_KEY = "claude_usage_limits_enabled";
const CLAUDE_USAGE_LIMITS_SHOW_SESSION_KEY = "claude_usage_limits_show_session";
const CLAUDE_USAGE_LIMITS_SHOW_WEEKLY_KEY = "claude_usage_limits_show_weekly";
const PROVIDER_USAGE_ENABLED_KEY = "provider_usage_enabled";
const PROVIDER_USAGE_IDS_KEY = "provider_usage_ids";
const AGENT_LAUNCHER_CONFIG_KEY = "agent_launcher_config";
const PET_ENABLED_KEY = "pet_enabled";
const PET_MESSAGES_ENABLED_KEY = "pet_messages_enabled";
const PET_SOUNDS_ENABLED_KEY = "pet_sounds_enabled";
const PET_STATE_KEY = "pet_state";
const TERMINAL_FONT_FAMILY_KEY = "terminal_font_family";
const TERMINAL_FONT_WEIGHT_KEY = "terminal_font_weight";
const TERMINAL_FONT_WEIGHT_BOLD_KEY = "terminal_font_weight_bold";
const TERMINAL_LINE_HEIGHT_KEY = "terminal_line_height";
const TERMINAL_LETTER_SPACING_KEY = "terminal_letter_spacing";
const INTERFACE_FONT_FAMILY_KEY = "interface_font_family";
const INTERFACE_FONT_SCALE_KEY = "interface_font_scale";

const voiceCommandAliasesBody = z.unknown().transform((value, ctx): VoiceCommandAliases => {
  try {
    return normalizeVoiceCommandAliases(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "invalid voiceCommandAliases",
    });
    return z.NEVER;
  }
});

const aiModelBody = z.union([z.string(), z.null()]).transform((value, ctx): AiModelId | null => {
  const normalized = normalizeAiModelId(value);
  if (normalized || value === null || (typeof value === "string" && value.trim() === "")) {
    return normalized;
  }
  ctx.addIssue({
    code: "custom",
    message: AI_MODEL_ID_HELP,
  });
  return z.NEVER;
});

// The api bearer token is intentionally NOT delivered over HTTP. It is only
// readable through the Electron IPC channel `settings:getToken`, so a page
// cannot exfiltrate it via fetch even from the same origin. See
// todos/bugs/done/02-api-settings-leaks-bearer-token.md for the original leak.
// .strict() so a stale client that still sends the removed `regenerate: true`
// field (or any other unknown key) gets a 400 instead of a silent no-op.
const updateSettingsBody = z
  .strictObject({
    agentSystemBannerDisabled: z.boolean(),
    accentColor: z.string().refine(isAccentColorId, { message: "invalid accentColor" }),
    minimalTheme: z.boolean(),
    themeStyle: z.string().refine(isThemeStyle, { message: "invalid themeStyle" }),
    surfaceTint: z.string().refine(isSurfaceTint, { message: "invalid surfaceTint" }),
    mouseGradientDisabled: z.boolean(),
    batterySaverEnabled: z.boolean(),
    sessionFinishToastEnabled: z.boolean(),
    sessionFinishOsNotificationEnabled: z.boolean(),
    notificationSoundEnabled: z.boolean(),
    launchOverlayEnabled: z.boolean(),
    automaticUpdateDownloadsEnabled: z.boolean(),
    automaticUpdateInstallOnQuitEnabled: z.boolean(),
    worktreesEnabled: z.boolean(),
    voiceControlEnabled: z.boolean(),
    questionOverlayEnabled: z.boolean(),
    gitDiffChangedFilesView: z.enum(GIT_DIFF_CHANGED_FILES_VIEWS).nullable(),
    gitDiffChangedFilesWidth: z
      .number()
      .int()
      .min(GIT_DIFF_CHANGED_FILES_WIDTH_MIN)
      .max(GIT_DIFF_CHANGED_FILES_WIDTH_MAX)
      .nullable(),
    projectsDashboardView: z.enum(PROJECTS_DASHBOARD_VIEWS).nullable(),
    selectedWorktreeByProject: z.record(z.string(), z.string()).nullable(),
    commitCli: z.union([z.enum(COMMIT_CLI_VALUES), z.null()]),
    terminalZoomLevel: z.number().int().min(TERMINAL_ZOOM_MIN).max(TERMINAL_ZOOM_MAX),
    terminalFontFamily: z
      .string()
      .max(FONT_FAMILY_MAX_LENGTH)
      .nullable()
      .transform((value) => normalizeFontFamily(value)),
    terminalFontWeight: z
      .number()
      .refine((value) => (TERMINAL_FONT_WEIGHTS as readonly number[]).includes(value), {
        message: "invalid terminalFontWeight",
      }),
    terminalFontWeightBold: z
      .number()
      .refine((value) => (TERMINAL_FONT_WEIGHTS as readonly number[]).includes(value), {
        message: "invalid terminalFontWeightBold",
      }),
    terminalLineHeight: z
      .number()
      .refine((value) => (TERMINAL_LINE_HEIGHTS as readonly number[]).includes(value), {
        message: "invalid terminalLineHeight",
      }),
    terminalLetterSpacing: z
      .number()
      .refine(
        (value) => (TERMINAL_LETTER_SPACINGS as readonly number[]).includes(value),
        { message: "invalid terminalLetterSpacing" },
      ),
    interfaceFontFamily: z
      .string()
      .max(FONT_FAMILY_MAX_LENGTH)
      .nullable()
      .transform((value) => normalizeFontFamily(value)),
    interfaceFontScale: z
      .number()
      .refine((value) => (INTERFACE_FONT_SCALES as readonly number[]).includes(value), {
        message: "invalid interfaceFontScale",
      }),
    sessionHeaderButtons: z
      .record(z.string(), z.boolean())
      .transform(
        (value): SessionHeaderButtonVisibility =>
          normalizeSessionHeaderButtonVisibility(value),
      ),
    defaultAgent: z.enum(AI_RUNTIME_HARNESS_VALUES),
    defaultModel: aiModelBody,
    annotationAgent: z.enum(AI_RUNTIME_HARNESS_VALUES),
    annotationModel: aiModelBody,
    shipAgent: z.enum(AI_RUNTIME_HARNESS_VALUES),
    shipModel: aiModelBody,
    shipPrompt: z.string().transform((value) => normalizeShipPrompt(value)),
    voiceCommandAliases: voiceCommandAliasesBody,
    claudeUsageLimitsEnabled: z.boolean(),
    claudeUsageLimitsShowSession: z.boolean(),
    claudeUsageLimitsShowWeekly: z.boolean(),
    providerUsageEnabled: z.boolean(),
    providerUsageIds: z.array(z.string()).transform((value) => normalizeProviderUsageIds(value)),
    agentLauncherConfig: z
      .object({ order: z.array(z.string()), hidden: z.array(z.string()) })
      .transform((value): AgentLauncherConfig => normalizeAgentLauncherConfig(value)),
    recallEnabled: z.boolean(),
    recallAutoCaptureEnabled: z.boolean(),
    recallEngineEnabled: z.boolean(),
    recallEngineHarness: z.enum(AI_RUNTIME_HARNESS_VALUES),
    recallEngineModel: aiModelBody,
    recallAgentWriteEnabled: z.boolean(),
    recallInjectBriefEnabled: z.boolean(),
    recallCodeGraphEnabled: z.boolean(),
    recallProactiveRecallEnabled: z.boolean(),
    recallLearnedToastEnabled: z.boolean(),
    petEnabled: z.boolean(),
    petMessagesEnabled: z.boolean(),
    petSoundsEnabled: z.boolean(),
    // Raw on purpose: update() distinguishes an explicit null (reset the pet)
    // from a payload that fails normalization (rejected — a malformed write
    // must never erase the stored pet).
    petState: z.unknown(),
  })
  .partial();

function getAccentColorSetting(): AccentColorId {
  const value = getSetting("accent_color");
  return isAccentColorId(value) ? value : DEFAULT_ACCENT_COLOR;
}

function getThemeStyleSetting(): ThemeStyle {
  const value = getSetting(THEME_STYLE_KEY);
  // Migrate on read: legacy rows stored "minimal" / "noir" / "ember", which all
  // collapse to "flat"; anything unrecognized falls back to painted.
  if (value !== null) return normalizeThemeStyle(value);
  // Installs that predate theme_style only stored the minimal/painted toggle.
  return getBooleanSetting(MINIMAL_THEME_KEY) ? "flat" : "painted";
}

function getSurfaceTintSetting(): SurfaceTint {
  const value = getSetting(SURFACE_TINT_KEY);
  return isSurfaceTint(value) ? value : DEFAULT_SURFACE_TINT;
}

function getCommitCliSetting(): CommitCli | null {
  const value = getSetting(COMMIT_CLI_SETTING_KEY);
  return isCommitCli(value) ? value : null;
}

function getDefaultAgentSetting(): AiRuntimeHarness {
  const value = getSetting(DEFAULT_AGENT_SETTING_KEY);
  return isAiRuntimeHarness(value) ? value : "claude-code";
}

function getDefaultModelSetting(): AiModelId | null {
  const value = getSetting(DEFAULT_MODEL_SETTING_KEY);
  return normalizeAiModelId(value);
}

function getAnnotationAgentSetting(): AiRuntimeHarness {
  const value = getSetting(ANNOTATION_AGENT_SETTING_KEY);
  return isAiRuntimeHarness(value) ? value : "claude-code";
}

function getAnnotationModelSetting(): AiModelId | null {
  const value = getSetting(ANNOTATION_MODEL_SETTING_KEY);
  return normalizeAiModelId(value);
}

function getShipAgentSetting(): AiRuntimeHarness {
  const value = getSetting(SHIP_AGENT_SETTING_KEY);
  return isAiRuntimeHarness(value) ? value : "claude-code";
}

function getShipModelSetting(): AiModelId | null {
  const value = getSetting(SHIP_MODEL_SETTING_KEY);
  return normalizeAiModelId(value);
}

function getShipPromptSetting(): string {
  const value = getSetting(SHIP_PROMPT_SETTING_KEY);
  return value === null ? DEFAULT_SHIP_PROMPT : normalizeShipPrompt(value);
}

function getGitDiffChangedFilesViewSetting() {
  return normalizeGitDiffChangedFilesView(getSetting(GIT_DIFF_CHANGED_FILES_VIEW_KEY));
}

function getGitDiffChangedFilesWidthSetting() {
  return normalizeGitDiffChangedFilesWidth(getSetting(GIT_DIFF_CHANGED_FILES_WIDTH_KEY));
}

function getProjectsDashboardViewSetting() {
  return normalizeProjectsDashboardView(getSetting(PROJECTS_DASHBOARD_VIEW_KEY));
}

function getSelectedWorktreeByProjectSetting() {
  const raw = getSetting(SELECTED_WORKTREE_BY_PROJECT_KEY);
  return normalizeSelectedWorktreeByProject(safeJsonParse<unknown>(raw, null));
}

function getTerminalZoomLevelSetting() {
  return normalizeTerminalZoomLevel(getSetting(TERMINAL_ZOOM_LEVEL_KEY)) ?? DEFAULT_TERMINAL_ZOOM_LEVEL;
}

function getTerminalFontFamilySetting(): string | null {
  return normalizeFontFamily(getSetting(TERMINAL_FONT_FAMILY_KEY));
}

function getTerminalFontWeightSetting() {
  return normalizeTerminalFontWeight(
    getSetting(TERMINAL_FONT_WEIGHT_KEY),
    DEFAULT_TERMINAL_FONT_WEIGHT,
  );
}

function getTerminalFontWeightBoldSetting() {
  return normalizeTerminalFontWeight(
    getSetting(TERMINAL_FONT_WEIGHT_BOLD_KEY),
    DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  );
}

function getTerminalLineHeightSetting() {
  return normalizeTerminalLineHeight(getSetting(TERMINAL_LINE_HEIGHT_KEY));
}

function getTerminalLetterSpacingSetting() {
  return normalizeTerminalLetterSpacing(getSetting(TERMINAL_LETTER_SPACING_KEY));
}

function getInterfaceFontFamilySetting(): string | null {
  return normalizeFontFamily(getSetting(INTERFACE_FONT_FAMILY_KEY));
}

function getInterfaceFontScaleSetting() {
  const raw = getSetting(INTERFACE_FONT_SCALE_KEY);
  return raw === null ? DEFAULT_INTERFACE_FONT_SCALE : normalizeInterfaceFontScale(raw);
}

function getSessionHeaderButtonsSetting(): SessionHeaderButtonVisibility {
  return normalizeSessionHeaderButtonVisibility(
    safeJsonParse<unknown>(getSetting(SESSION_HEADER_BUTTONS_KEY), null),
  );
}

function getAgentLauncherConfigSetting(): AgentLauncherConfig {
  return normalizeAgentLauncherConfig(
    safeJsonParse<unknown>(getSetting(AGENT_LAUNCHER_CONFIG_KEY), null),
  );
}

function getVoiceCommandAliasesSetting() {
  const raw = getSetting(VOICE_COMMAND_ALIASES_KEY);
  try {
    return normalizeVoiceCommandAliases(safeJsonParse<unknown>(raw, null));
  } catch {
    return emptyVoiceCommandAliases();
  }
}

function settingsPayload() {
  const themeStyle = getThemeStyleSetting();
  return {
    agentSystemBannerDisabled: getBooleanSetting("agent_system_banner_disabled"),
    accentColor: getAccentColorSetting(),
    themeStyle,
    surfaceTint: getSurfaceTintSetting(),
    // Derived: true whenever the style renders clean CSS chrome (the flat
    // theme). Layout consumers key off this; the style picker reads themeStyle.
    minimalTheme: themeStyle !== "painted",
    // Raw-key check — the getters above normalize absent rows to defaults,
    // which would erase the "never chosen" signal. False only on a fresh
    // install where no theme setting was ever written. Gates the first-launch
    // theme picker; localStorage can't, because the renderer's localhost port
    // (and thus its storage origin) can change between launches.
    themeChosen:
      getSetting("accent_color") !== null ||
      getSetting(THEME_STYLE_KEY) !== null ||
      getSetting(MINIMAL_THEME_KEY) !== null,
    mouseGradientDisabled: getBooleanSetting("mouse_gradient_disabled"),
    // On battery, the renderer freezes decorative animations and slows idle
    // polls (see src/lib/power-save.ts). Default on.
    batterySaverEnabled: getBooleanSetting("battery_saver_enabled", true),
    sessionFinishToastEnabled: getBooleanSetting("session_finish_toast_enabled", true),
    sessionFinishOsNotificationEnabled: getBooleanSetting(
      "session_finish_os_notification_enabled",
      false,
    ),
    notificationSoundEnabled: getBooleanSetting("notification_sound_enabled", true),
    launchOverlayEnabled: getBooleanSetting("launch_overlay_enabled", false),
    automaticUpdateDownloadsEnabled: getBooleanSetting(
      "automatic_update_downloads_enabled",
      false,
    ),
    automaticUpdateInstallOnQuitEnabled: getBooleanSetting(
      "automatic_update_install_on_quit_enabled",
      false,
    ),
    // Always on — worktrees graduated from experimental; ignore any stored preference.
    worktreesEnabled: true,
    voiceControlEnabled: getBooleanSetting("voice_control_enabled", false),
    questionOverlayEnabled: getBooleanSetting("question_overlay_enabled", true),
    gitDiffChangedFilesView: getGitDiffChangedFilesViewSetting(),
    gitDiffChangedFilesWidth: getGitDiffChangedFilesWidthSetting(),
    projectsDashboardView: getProjectsDashboardViewSetting(),
    selectedWorktreeByProject: getSelectedWorktreeByProjectSetting(),
    commitCli: getCommitCliSetting(),
    terminalZoomLevel: getTerminalZoomLevelSetting(),
    terminalFontFamily: getTerminalFontFamilySetting(),
    terminalFontWeight: getTerminalFontWeightSetting(),
    terminalFontWeightBold: getTerminalFontWeightBoldSetting(),
    terminalLineHeight: getTerminalLineHeightSetting(),
    terminalLetterSpacing: getTerminalLetterSpacingSetting(),
    interfaceFontFamily: getInterfaceFontFamilySetting(),
    interfaceFontScale: getInterfaceFontScaleSetting(),
    sessionHeaderButtons: getSessionHeaderButtonsSetting(),
    defaultAgent: getDefaultAgentSetting(),
    defaultModel: getDefaultModelSetting(),
    annotationAgent: getAnnotationAgentSetting(),
    annotationModel: getAnnotationModelSetting(),
    shipAgent: getShipAgentSetting(),
    shipModel: getShipModelSetting(),
    shipPrompt: getShipPromptSetting(),
    voiceCommandAliases: getVoiceCommandAliasesSetting(),
    // Off by default: usage reaches out to provider APIs using local logins.
    claudeUsageLimitsEnabled: getBooleanSetting(CLAUDE_USAGE_LIMITS_ENABLED_KEY, false),
    claudeUsageLimitsShowSession: getBooleanSetting(CLAUDE_USAGE_LIMITS_SHOW_SESSION_KEY, true),
    claudeUsageLimitsShowWeekly: getBooleanSetting(CLAUDE_USAGE_LIMITS_SHOW_WEEKLY_KEY, true),
    // Multi-provider (CodexBar fork). If unset, fall back to legacy Claude-only toggle
    // so existing users who already enabled Claude usage keep their indicator.
    providerUsageEnabled: getProviderUsageEnabledSetting(),
    providerUsageIds: getProviderUsageIdsSetting(),
    agentLauncherConfig: getAgentLauncherConfigSetting(),
    petEnabled: getBooleanSetting(PET_ENABLED_KEY, true),
    petMessagesEnabled: getBooleanSetting(PET_MESSAGES_ENABLED_KEY, true),
    petSoundsEnabled: getBooleanSetting(PET_SOUNDS_ENABLED_KEY, false),
    petState: normalizePetState(safeJsonParse<unknown>(getSetting(PET_STATE_KEY), null)),
    ...recallSettingsPayload(),
  };
}

function getProviderUsageEnabledSetting(): boolean {
  const raw = getSetting(PROVIDER_USAGE_ENABLED_KEY);
  if (raw !== null) return raw === "true" || raw === "1";
  // Legacy: Claude-only toggle stood in for the master switch.
  return getBooleanSetting(CLAUDE_USAGE_LIMITS_ENABLED_KEY, false);
}

function getProviderUsageIdsSetting(): ProviderUsageId[] {
  const raw = getSetting(PROVIDER_USAGE_IDS_KEY);
  if (raw === null) {
    // If only Claude was enabled historically, keep Claude as the sole provider.
    if (getBooleanSetting(CLAUDE_USAGE_LIMITS_ENABLED_KEY, false)) return ["claude"];
    return [...DEFAULT_PROVIDER_USAGE_IDS];
  }
  try {
    return normalizeProviderUsageIds(JSON.parse(raw));
  } catch {
    return [...DEFAULT_PROVIDER_USAGE_IDS];
  }
}

function recallSettingsPayload() {
  const recall = readRecallSettings();
  return {
    recallEnabled: recall.enabled,
    recallAutoCaptureEnabled: recall.autoCaptureEnabled,
    recallEngineEnabled: recall.recallEngineEnabled,
    recallEngineHarness: recall.recallEngineHarness,
    recallEngineModel: recall.recallEngineModel,
    recallAgentWriteEnabled: recall.agentWriteEnabled,
    recallInjectBriefEnabled: recall.injectBriefEnabled,
    recallCodeGraphEnabled: recall.codeGraphEnabled,
    recallProactiveRecallEnabled: recall.proactiveRecallEnabled,
    recallLearnedToastEnabled: recall.learnedToastEnabled,
  };
}

export function read(): Response {
  return json(settingsPayload());
}

export async function update(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, updateSettingsBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.agentSystemBannerDisabled !== undefined) {
    setBooleanSetting("agent_system_banner_disabled", body.agentSystemBannerDisabled);
  }
  if (body.accentColor !== undefined) {
    setSetting("accent_color", body.accentColor);
  }
  if (body.minimalTheme !== undefined) {
    // Legacy toggle: on means the flat theme, off means painted. (getThemeStyle
    // -Setting already migrates any stored legacy style to "flat".)
    setBooleanSetting(MINIMAL_THEME_KEY, body.minimalTheme);
    setSetting(THEME_STYLE_KEY, body.minimalTheme ? "flat" : "painted");
  }
  if (body.themeStyle !== undefined) {
    setSetting(THEME_STYLE_KEY, body.themeStyle);
    // Keep the legacy boolean in sync so a downgraded build restores the choice.
    setBooleanSetting(MINIMAL_THEME_KEY, body.themeStyle !== "painted");
  }
  if (body.surfaceTint !== undefined) {
    setSetting(SURFACE_TINT_KEY, body.surfaceTint);
  }
  if (body.mouseGradientDisabled !== undefined) {
    setBooleanSetting("mouse_gradient_disabled", body.mouseGradientDisabled);
  }
  if (body.batterySaverEnabled !== undefined) {
    setBooleanSetting("battery_saver_enabled", body.batterySaverEnabled);
  }
  if (body.sessionFinishToastEnabled !== undefined) {
    setBooleanSetting("session_finish_toast_enabled", body.sessionFinishToastEnabled);
  }
  if (body.sessionFinishOsNotificationEnabled !== undefined) {
    setBooleanSetting(
      "session_finish_os_notification_enabled",
      body.sessionFinishOsNotificationEnabled,
    );
  }
  if (body.notificationSoundEnabled !== undefined) {
    setBooleanSetting("notification_sound_enabled", body.notificationSoundEnabled);
  }
  if (body.launchOverlayEnabled !== undefined) {
    setBooleanSetting("launch_overlay_enabled", body.launchOverlayEnabled);
  }
  if (body.automaticUpdateDownloadsEnabled !== undefined) {
    setBooleanSetting(
      "automatic_update_downloads_enabled",
      body.automaticUpdateDownloadsEnabled,
    );
  }
  if (body.automaticUpdateInstallOnQuitEnabled !== undefined) {
    setBooleanSetting(
      "automatic_update_install_on_quit_enabled",
      body.automaticUpdateInstallOnQuitEnabled,
    );
  }
  // worktreesEnabled is always on; ignore writes so old clients can't turn it off.
  if (body.voiceControlEnabled !== undefined) {
    setBooleanSetting("voice_control_enabled", body.voiceControlEnabled);
  }
  if (body.questionOverlayEnabled !== undefined) {
    setBooleanSetting("question_overlay_enabled", body.questionOverlayEnabled);
  }
  if (body.gitDiffChangedFilesView !== undefined) {
    if (body.gitDiffChangedFilesView === null) {
      deleteSetting(GIT_DIFF_CHANGED_FILES_VIEW_KEY);
    } else {
      setSetting(GIT_DIFF_CHANGED_FILES_VIEW_KEY, body.gitDiffChangedFilesView);
    }
  }
  if (body.gitDiffChangedFilesWidth !== undefined) {
    if (body.gitDiffChangedFilesWidth === null) {
      deleteSetting(GIT_DIFF_CHANGED_FILES_WIDTH_KEY);
    } else {
      setSetting(GIT_DIFF_CHANGED_FILES_WIDTH_KEY, String(body.gitDiffChangedFilesWidth));
    }
  }
  if (body.projectsDashboardView !== undefined) {
    if (body.projectsDashboardView === null) {
      deleteSetting(PROJECTS_DASHBOARD_VIEW_KEY);
    } else {
      setSetting(PROJECTS_DASHBOARD_VIEW_KEY, body.projectsDashboardView);
    }
  }
  if (body.selectedWorktreeByProject !== undefined) {
    if (body.selectedWorktreeByProject === null) {
      deleteSetting(SELECTED_WORKTREE_BY_PROJECT_KEY);
    } else {
      setSetting(
        SELECTED_WORKTREE_BY_PROJECT_KEY,
        JSON.stringify(body.selectedWorktreeByProject),
      );
    }
  }
  if (body.commitCli !== undefined) {
    if (body.commitCli === null) {
      deleteSetting(COMMIT_CLI_SETTING_KEY);
    } else {
      setSetting(COMMIT_CLI_SETTING_KEY, body.commitCli);
    }
  }
  if (body.terminalZoomLevel !== undefined) {
    setSetting(TERMINAL_ZOOM_LEVEL_KEY, String(body.terminalZoomLevel));
  }
  if (body.terminalFontFamily !== undefined) {
    if (body.terminalFontFamily === null) {
      deleteSetting(TERMINAL_FONT_FAMILY_KEY);
    } else {
      setSetting(TERMINAL_FONT_FAMILY_KEY, body.terminalFontFamily);
    }
  }
  if (body.terminalFontWeight !== undefined) {
    setSetting(TERMINAL_FONT_WEIGHT_KEY, String(body.terminalFontWeight));
  }
  if (body.terminalFontWeightBold !== undefined) {
    setSetting(TERMINAL_FONT_WEIGHT_BOLD_KEY, String(body.terminalFontWeightBold));
  }
  if (body.terminalLineHeight !== undefined) {
    setSetting(TERMINAL_LINE_HEIGHT_KEY, String(body.terminalLineHeight));
  }
  if (body.terminalLetterSpacing !== undefined) {
    setSetting(TERMINAL_LETTER_SPACING_KEY, String(body.terminalLetterSpacing));
  }
  if (body.interfaceFontFamily !== undefined) {
    if (body.interfaceFontFamily === null) {
      deleteSetting(INTERFACE_FONT_FAMILY_KEY);
    } else {
      setSetting(INTERFACE_FONT_FAMILY_KEY, body.interfaceFontFamily);
    }
  }
  if (body.interfaceFontScale !== undefined) {
    setSetting(INTERFACE_FONT_SCALE_KEY, String(body.interfaceFontScale));
  }
  if (body.sessionHeaderButtons !== undefined) {
    setSetting(SESSION_HEADER_BUTTONS_KEY, JSON.stringify(body.sessionHeaderButtons));
  }
  if (body.defaultAgent !== undefined) {
    setSetting(DEFAULT_AGENT_SETTING_KEY, body.defaultAgent);
  }
  if (body.defaultModel !== undefined) {
    if (body.defaultModel === null) {
      deleteSetting(DEFAULT_MODEL_SETTING_KEY);
    } else {
      setSetting(DEFAULT_MODEL_SETTING_KEY, body.defaultModel);
    }
  }
  if (body.annotationAgent !== undefined) {
    setSetting(ANNOTATION_AGENT_SETTING_KEY, body.annotationAgent);
  }
  if (body.annotationModel !== undefined) {
    if (body.annotationModel === null) {
      deleteSetting(ANNOTATION_MODEL_SETTING_KEY);
    } else {
      setSetting(ANNOTATION_MODEL_SETTING_KEY, body.annotationModel);
    }
  }
  if (body.shipAgent !== undefined) {
    setSetting(SHIP_AGENT_SETTING_KEY, body.shipAgent);
  }
  if (body.shipModel !== undefined) {
    if (body.shipModel === null) {
      deleteSetting(SHIP_MODEL_SETTING_KEY);
    } else {
      setSetting(SHIP_MODEL_SETTING_KEY, body.shipModel);
    }
  }
  if (body.shipPrompt !== undefined) {
    setSetting(SHIP_PROMPT_SETTING_KEY, body.shipPrompt);
  }
  if (body.voiceCommandAliases !== undefined) {
    setSetting(VOICE_COMMAND_ALIASES_KEY, JSON.stringify(body.voiceCommandAliases));
  }
  if (body.claudeUsageLimitsEnabled !== undefined) {
    setBooleanSetting(CLAUDE_USAGE_LIMITS_ENABLED_KEY, body.claudeUsageLimitsEnabled);
  }
  if (body.claudeUsageLimitsShowSession !== undefined) {
    setBooleanSetting(CLAUDE_USAGE_LIMITS_SHOW_SESSION_KEY, body.claudeUsageLimitsShowSession);
  }
  if (body.claudeUsageLimitsShowWeekly !== undefined) {
    setBooleanSetting(CLAUDE_USAGE_LIMITS_SHOW_WEEKLY_KEY, body.claudeUsageLimitsShowWeekly);
  }
  if (body.providerUsageEnabled !== undefined) {
    setBooleanSetting(PROVIDER_USAGE_ENABLED_KEY, body.providerUsageEnabled);
    // Keep Claude legacy flag aligned when Claude is among enabled providers.
    const ids =
      body.providerUsageIds ??
      getProviderUsageIdsSetting();
    if (ids.includes("claude")) {
      setBooleanSetting(CLAUDE_USAGE_LIMITS_ENABLED_KEY, body.providerUsageEnabled);
    }
  }
  if (body.providerUsageIds !== undefined) {
    setSetting(PROVIDER_USAGE_IDS_KEY, JSON.stringify(body.providerUsageIds));
  }
  if (body.agentLauncherConfig !== undefined) {
    setSetting(AGENT_LAUNCHER_CONFIG_KEY, JSON.stringify(body.agentLauncherConfig));
  }
  if (body.petEnabled !== undefined) {
    setBooleanSetting(PET_ENABLED_KEY, body.petEnabled);
  }
  if (body.petMessagesEnabled !== undefined) {
    setBooleanSetting(PET_MESSAGES_ENABLED_KEY, body.petMessagesEnabled);
  }
  if (body.petSoundsEnabled !== undefined) {
    setBooleanSetting(PET_SOUNDS_ENABLED_KEY, body.petSoundsEnabled);
  }
  if (body.petState !== undefined) {
    if (body.petState === null) {
      deleteSetting(PET_STATE_KEY);
    } else {
      const incoming = normalizePetState(body.petState);
      if (!incoming) return jsonError(HTTP_BAD_REQUEST, "invalid petState");
      // Merge against the stored state so a stale renderer window (each holds
      // its own copy, hydrated once at boot) can't revert a molt, level-up, or
      // lifetime counters that another window already persisted.
      const stored = normalizePetState(safeJsonParse<unknown>(getSetting(PET_STATE_KEY), null));
      setSetting(PET_STATE_KEY, JSON.stringify(mergePetStateWrite(stored, incoming)));
    }
  }
  writeRecallSettings({
    enabled: body.recallEnabled,
    autoCaptureEnabled: body.recallAutoCaptureEnabled,
    recallEngineEnabled: body.recallEngineEnabled,
    recallEngineHarness: body.recallEngineHarness,
    recallEngineModel: body.recallEngineModel,
    agentWriteEnabled: body.recallAgentWriteEnabled,
    injectBriefEnabled: body.recallInjectBriefEnabled,
    codeGraphEnabled: body.recallCodeGraphEnabled,
    proactiveRecallEnabled: body.recallProactiveRecallEnabled,
    learnedToastEnabled: body.recallLearnedToastEnabled,
  });
  return json(settingsPayload());
}

/** Used by the commit service to read the persisted CLI choice without an HTTP round-trip. */
export function readCommitCliSetting(): CommitCli | null {
  return getCommitCliSetting();
}

/** Persist a CLI choice from the server side (used when auto-detection seeds a value). */
export function writeCommitCliSetting(cli: CommitCli): void {
  setSetting(COMMIT_CLI_SETTING_KEY, cli);
}
