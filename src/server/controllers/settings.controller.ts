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
  DEFAULT_TERMINAL_ZOOM_LEVEL,
  TERMINAL_ZOOM_MAX,
  TERMINAL_ZOOM_MIN,
  normalizeTerminalZoomLevel,
} from "~/shared/terminal-zoom";
import {
  emptyVoiceCommandAliases,
  normalizeVoiceCommandAliases,
  type VoiceCommandAliases,
} from "~/shared/voice-command-aliases";
import { json, parseJsonBody } from "./_helpers";

const COMMIT_CLI_SETTING_KEY = "commit_cli";
const DEFAULT_AGENT_SETTING_KEY = "default_agent";
const DEFAULT_MODEL_SETTING_KEY = "default_model";
const ANNOTATION_AGENT_SETTING_KEY = "annotation_agent";
const ANNOTATION_MODEL_SETTING_KEY = "annotation_model";
const GIT_DIFF_CHANGED_FILES_VIEW_KEY = "git_diff_changed_files_view";
const GIT_DIFF_CHANGED_FILES_WIDTH_KEY = "git_diff_changed_files_width";
const SELECTED_WORKTREE_BY_PROJECT_KEY = "selected_worktree_by_project";
const PROJECTS_DASHBOARD_VIEW_KEY = "projects_dashboard_view";
const TERMINAL_ZOOM_LEVEL_KEY = "terminal_zoom_level";
const VOICE_COMMAND_ALIASES_KEY = "voice_command_aliases";

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
    mouseGradientDisabled: z.boolean(),
    sessionFinishToastEnabled: z.boolean(),
    sessionFinishOsNotificationEnabled: z.boolean(),
    notificationSoundEnabled: z.boolean(),
    launchOverlayEnabled: z.boolean(),
    automaticUpdateDownloadsEnabled: z.boolean(),
    automaticUpdateInstallOnQuitEnabled: z.boolean(),
    worktreesEnabled: z.boolean(),
    voiceControlEnabled: z.boolean(),
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
    defaultAgent: z.enum(AI_RUNTIME_HARNESS_VALUES),
    defaultModel: aiModelBody,
    annotationAgent: z.enum(AI_RUNTIME_HARNESS_VALUES),
    annotationModel: aiModelBody,
    voiceCommandAliases: voiceCommandAliasesBody,
  })
  .partial();

function getAccentColorSetting(): AccentColorId {
  const value = getSetting("accent_color");
  return isAccentColorId(value) ? value : DEFAULT_ACCENT_COLOR;
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

function getVoiceCommandAliasesSetting() {
  const raw = getSetting(VOICE_COMMAND_ALIASES_KEY);
  try {
    return normalizeVoiceCommandAliases(safeJsonParse<unknown>(raw, null));
  } catch {
    return emptyVoiceCommandAliases();
  }
}

function settingsPayload() {
  return {
    agentSystemBannerDisabled: getBooleanSetting("agent_system_banner_disabled"),
    accentColor: getAccentColorSetting(),
    minimalTheme: getBooleanSetting("minimal_theme"),
    mouseGradientDisabled: getBooleanSetting("mouse_gradient_disabled"),
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
    worktreesEnabled: getBooleanSetting("worktrees_enabled", false),
    voiceControlEnabled: getBooleanSetting("voice_control_enabled", false),
    gitDiffChangedFilesView: getGitDiffChangedFilesViewSetting(),
    gitDiffChangedFilesWidth: getGitDiffChangedFilesWidthSetting(),
    projectsDashboardView: getProjectsDashboardViewSetting(),
    selectedWorktreeByProject: getSelectedWorktreeByProjectSetting(),
    commitCli: getCommitCliSetting(),
    terminalZoomLevel: getTerminalZoomLevelSetting(),
    defaultAgent: getDefaultAgentSetting(),
    defaultModel: getDefaultModelSetting(),
    annotationAgent: getAnnotationAgentSetting(),
    annotationModel: getAnnotationModelSetting(),
    voiceCommandAliases: getVoiceCommandAliasesSetting(),
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
    setBooleanSetting("minimal_theme", body.minimalTheme);
  }
  if (body.mouseGradientDisabled !== undefined) {
    setBooleanSetting("mouse_gradient_disabled", body.mouseGradientDisabled);
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
  if (body.worktreesEnabled !== undefined) {
    setBooleanSetting("worktrees_enabled", body.worktreesEnabled);
  }
  if (body.voiceControlEnabled !== undefined) {
    setBooleanSetting("voice_control_enabled", body.voiceControlEnabled);
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
  if (body.voiceCommandAliases !== undefined) {
    setSetting(VOICE_COMMAND_ALIASES_KEY, JSON.stringify(body.voiceCommandAliases));
  }
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
