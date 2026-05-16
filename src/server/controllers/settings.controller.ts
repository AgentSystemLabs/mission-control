import { z } from "zod";
import {
  getBooleanSetting,
  getOrCreateApiToken,
  getSetting,
  regenerateApiToken,
  setBooleanSetting,
  setSetting,
} from "../services/settings";
import {
  DEFAULT_ACCENT_COLOR,
  isAccentColorId,
  type AccentColorId,
} from "~/lib/accent-colors";
import { json, parseJsonBody } from "./_helpers";

const updateSettingsBody = z
  .object({
    regenerate: z.boolean(),
    agentSystemBannerDisabled: z.boolean(),
    accentColor: z.string().refine(isAccentColorId, { message: "invalid accentColor" }),
    minimalTheme: z.boolean(),
    mouseGradientDisabled: z.boolean(),
    sessionFinishToastEnabled: z.boolean(),
    sessionFinishOsNotificationEnabled: z.boolean(),
  })
  .partial();

function getAccentColorSetting(): AccentColorId {
  const value = getSetting("accent_color");
  return isAccentColorId(value) ? value : DEFAULT_ACCENT_COLOR;
}

function settingsPayload() {
  return {
    apiToken: getOrCreateApiToken(),
    agentSystemBannerDisabled: getBooleanSetting("agent_system_banner_disabled"),
    accentColor: getAccentColorSetting(),
    minimalTheme: getBooleanSetting("minimal_theme"),
    mouseGradientDisabled: getBooleanSetting("mouse_gradient_disabled"),
    sessionFinishToastEnabled: getBooleanSetting("session_finish_toast_enabled", true),
    sessionFinishOsNotificationEnabled: getBooleanSetting(
      "session_finish_os_notification_enabled",
      false,
    ),
  };
}

export function read(): Response {
  return json(settingsPayload());
}

export async function update(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, updateSettingsBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.regenerate) {
    const apiToken = regenerateApiToken();
    return json({ ...settingsPayload(), apiToken });
  }
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
  return json(settingsPayload());
}
