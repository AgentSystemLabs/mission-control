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
  GIT_DIFF_CHANGED_FILES_VIEWS,
  GIT_DIFF_CHANGED_FILES_WIDTH_MAX,
  GIT_DIFF_CHANGED_FILES_WIDTH_MIN,
  normalizeGitDiffChangedFilesView,
  normalizeGitDiffChangedFilesWidth,
  normalizeSelectedWorktreeByProject,
} from "~/shared/ui-preferences";
import { json, parseJsonBody } from "./_helpers";

const COMMIT_CLI_SETTING_KEY = "commit_cli";
const GIT_DIFF_CHANGED_FILES_VIEW_KEY = "git_diff_changed_files_view";
const GIT_DIFF_CHANGED_FILES_WIDTH_KEY = "git_diff_changed_files_width";
const SELECTED_WORKTREE_BY_PROJECT_KEY = "selected_worktree_by_project";

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
    launchOverlayEnabled: z.boolean(),
    automaticUpdateDownloadsEnabled: z.boolean(),
    automaticUpdateInstallOnQuitEnabled: z.boolean(),
    worktreesEnabled: z.boolean(),
    gitDiffChangedFilesView: z.enum(GIT_DIFF_CHANGED_FILES_VIEWS).nullable(),
    gitDiffChangedFilesWidth: z
      .number()
      .int()
      .min(GIT_DIFF_CHANGED_FILES_WIDTH_MIN)
      .max(GIT_DIFF_CHANGED_FILES_WIDTH_MAX)
      .nullable(),
    selectedWorktreeByProject: z.record(z.string(), z.string()).nullable(),
    commitCli: z.union([z.enum(COMMIT_CLI_VALUES), z.null()]),
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

function getGitDiffChangedFilesViewSetting() {
  return normalizeGitDiffChangedFilesView(getSetting(GIT_DIFF_CHANGED_FILES_VIEW_KEY));
}

function getGitDiffChangedFilesWidthSetting() {
  return normalizeGitDiffChangedFilesWidth(getSetting(GIT_DIFF_CHANGED_FILES_WIDTH_KEY));
}

function getSelectedWorktreeByProjectSetting() {
  const raw = getSetting(SELECTED_WORKTREE_BY_PROJECT_KEY);
  if (!raw) return null;
  try {
    return normalizeSelectedWorktreeByProject(JSON.parse(raw));
  } catch {
    return null;
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
    gitDiffChangedFilesView: getGitDiffChangedFilesViewSetting(),
    gitDiffChangedFilesWidth: getGitDiffChangedFilesWidthSetting(),
    selectedWorktreeByProject: getSelectedWorktreeByProjectSetting(),
    commitCli: getCommitCliSetting(),
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
