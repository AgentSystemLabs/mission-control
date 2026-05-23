import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { Field, SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { getElectron } from "~/lib/electron";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import {
  CURRENT_MC_VERSION,
  useLatestMissionControlVersion,
} from "~/queries/mission-control-version";
import {
  canTriggerUpdateCheck,
  triggerUpdateDownload,
  triggerUpdateCheck,
  triggerUpdateInstall,
  useAutoUpdaterState,
} from "~/queries/mc-auto-updater";
import { DEFAULT_ACCENT_COLOR } from "~/lib/accent-colors";
import {
  readCachedLaunchIntroEnabled,
  writeCachedLaunchIntroEnabled,
} from "~/lib/launch-intro";

export function GeneralSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const mouseGradientEnabled = !(settings?.mouseGradientDisabled ?? false);
  const toastEnabled = settings?.sessionFinishToastEnabled ?? true;
  const osNotificationEnabled =
    settings?.sessionFinishOsNotificationEnabled ?? false;
  const automaticUpdateDownloadsEnabled =
    settings?.automaticUpdateDownloadsEnabled ?? false;
  const automaticUpdateInstallOnQuitEnabled =
    settings?.automaticUpdateInstallOnQuitEnabled ?? false;
  const [launchOverlayEnabled, setLaunchOverlayEnabledState] = useState(
    () => readCachedLaunchIntroEnabled(),
  );
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const [permissionHint, setPermissionHint] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setPermission("unsupported");
      return;
    }
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (typeof settings?.launchOverlayEnabled !== "boolean") return;
    setLaunchOverlayEnabledState(settings.launchOverlayEnabled);
    writeCachedLaunchIntroEnabled(settings.launchOverlayEnabled);
  }, [settings?.launchOverlayEnabled]);

  const optimisticSettings = (
    patch: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "mouseGradientDisabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "launchOverlayEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
      >
    >,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor: settings?.accentColor ?? DEFAULT_ACCENT_COLOR,
    minimalTheme: settings?.minimalTheme ?? false,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    sessionFinishToastEnabled: toastEnabled,
    sessionFinishOsNotificationEnabled: osNotificationEnabled,
    launchOverlayEnabled,
    automaticUpdateDownloadsEnabled,
    automaticUpdateInstallOnQuitEnabled,
    gitDiffChangedFilesView: settings?.gitDiffChangedFilesView ?? null,
    gitDiffChangedFilesWidth: settings?.gitDiffChangedFilesWidth ?? null,
    selectedWorktreeByProject: settings?.selectedWorktreeByProject ?? null,
    commitCli: settings?.commitCli ?? null,
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
    worktreesEnabled:
      queryClient.getQueryData<AppSettings>(queryKeys.settings)?.worktreesEnabled ??
      settings?.worktreesEnabled ??
      false,
    ...patch,
  });

  const updateSettings = async (
    patch: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "mouseGradientDisabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "launchOverlayEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
      >
    >,
  ) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings(patch);
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const next = await api.updateSettings(patch);
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...next });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  const setMouseGradientEnabled = async (enabled: boolean) => {
    await updateSettings({ mouseGradientDisabled: !enabled });
  };

  const setToastEnabled = async (sessionFinishToastEnabled: boolean) => {
    await updateSettings({ sessionFinishToastEnabled });
  };

  const setLaunchOverlayEnabled = (enabled: boolean) => {
    setLaunchOverlayEnabledState(enabled);
    writeCachedLaunchIntroEnabled(enabled);
    queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
      current ? { ...current, launchOverlayEnabled: enabled } : current,
    );
    void api
      .updateSettings({ launchOverlayEnabled: enabled })
      .then((next) => {
        queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) => ({
          ...(current ?? optimisticSettings({})),
          ...next,
          launchOverlayEnabled: enabled,
        }));
      })
      .catch((error) => {
        console.error("[settings] failed to sync launch intro preference:", error);
        queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
          current ? { ...current, launchOverlayEnabled: enabled } : current,
        );
      });
  };

  const setAutomaticUpdateDownloadsEnabled = async (enabled: boolean) => {
    await updateSettings({ automaticUpdateDownloadsEnabled: enabled });
    if (enabled) {
      try {
        await triggerUpdateCheck();
      } catch (err) {
        console.error("[updater] check after enabling auto-download failed:", err);
      }
    }
  };

  const setAutomaticUpdateInstallOnQuitEnabled = async (enabled: boolean) => {
    await updateSettings({ automaticUpdateInstallOnQuitEnabled: enabled });
  };

  const setOsNotificationEnabled = async (enabled: boolean) => {
    setPermissionHint(null);
    if (enabled) {
      if (permission === "unsupported") {
        setPermissionHint("OS notifications are not supported in this environment.");
        return;
      }
      if (Notification.permission === "default") {
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result !== "granted") {
          setPermissionHint(
            "Notification permission was not granted. Enable it in your OS or browser settings, then try again.",
          );
          return;
        }
      } else if (Notification.permission === "denied") {
        setPermissionHint(
          "Notification permission is blocked. Enable it in your OS or browser settings, then try again.",
        );
        return;
      }
    }
    await updateSettings({
      sessionFinishOsNotificationEnabled: enabled,
    });
  };

  return (
    <>
      <SettingsSection
        title="General"
        subtitle="Control app-wide interface preferences."
        headingLevel="h1"
      >
        {/* AgentSystem.dev banner toggle hidden for now — the banner itself
            is also gated off in __root.tsx. */}
        <Field label="Mouse gradient">
          <ToggleRow
            title="Show mouse gradient"
            description="Cursor and card gradients follow the pointer across the workspace."
            checked={mouseGradientEnabled}
            onChange={setMouseGradientEnabled}
            label="Enable"
          />
        </Field>
        <Field label="Startup loading screen">
          <ToggleRow
            title="Show launch intro"
            description="Sliding doors, voice, and sound effects play the next time Mission Control loads."
            checked={launchOverlayEnabled}
            onChange={setLaunchOverlayEnabled}
            label="Enable"
          />
        </Field>
        <Field label="Updates">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ToggleRow
              title="Download updates automatically"
              description="When enabled, Mission Control downloads app updates in the background after a check finds one."
              checked={automaticUpdateDownloadsEnabled}
              onChange={setAutomaticUpdateDownloadsEnabled}
              label="Enable automatic update downloads"
            />
            <ToggleRow
              title="Install updates when quitting"
              description="When enabled, a downloaded update installs the next time you quit Mission Control. Otherwise use Restart to install."
              checked={automaticUpdateInstallOnQuitEnabled}
              onChange={setAutomaticUpdateInstallOnQuitEnabled}
              label="Enable install on quit"
            />
          </div>
        </Field>
      </SettingsSection>
      <SettingsSection
        title="Session finish notifications"
        subtitle="Get notified when a Claude session finishes in any project."
      >
        <Field label="Toast">
          <ToggleRow
            title="Show toast"
            description="A toast appears in the bottom-right when a session finishes."
            checked={toastEnabled}
            onChange={setToastEnabled}
            label="Show toast"
          />
        </Field>
        <Field label="OS notification">
          <ToggleRow
            title="OS notification"
            description={
              permission === "unsupported"
                ? "Not supported in this environment."
                : "A native OS notification appears so you see it even when the app is in the background."
            }
            checked={osNotificationEnabled}
            onChange={setOsNotificationEnabled}
            disabled={permission === "unsupported"}
            label="Enable"
          />
          {permissionHint && (
            <div
              role="status"
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--text-dim)",
                lineHeight: 1.45,
              }}
            >
              {permissionHint}
            </div>
          )}
        </Field>
      </SettingsSection>
      <AboutSection />
      <ReloadSection />
    </>
  );
}

function AboutSection() {
  const { data: academy, isLoading: academyLoading, isError: academyError } =
    useLatestMissionControlVersion();
  const updater = useAutoUpdaterState();
  const statusId = useId();
  const latest = academy?.latestVersion;
  const academyHasUpdate = !!academy?.isUpdateAvailable;

  const openBrowserDownload = () => {
    if (!academy?.downloadUrl) return;
    const api = (window as any).electronAPI;
    if (api?.openExternal) void api.openExternal(academy.downloadUrl);
    else window.open(academy.downloadUrl, "_blank", "noopener,noreferrer");
  };

  let status: string;
  let action: { label: string; onClick: () => void } | null = null;
  const busy =
    updater.kind === "priming" ||
    updater.kind === "checking" ||
    updater.kind === "downloading";
  const checkForUpdate = async () => {
    try {
      await triggerUpdateCheck();
    } catch (err) {
      console.error("[updater] check failed; falling through to browser:", err);
      openBrowserDownload();
    }
  };
  const downloadUpdate = async () => {
    const res = await triggerUpdateDownload();
    if (!res.ok) {
      console.error("[updater] download failed:", res.error);
      if (academy?.downloadUrl) openBrowserDownload();
    }
  };

  switch (updater.kind) {
    case "priming":
      status = "Checking for updates…";
      break;
    case "checking":
      status = "Checking for updates…";
      break;
    case "available":
      status = `Update v${updater.version} found.`;
      action = { label: "Download", onClick: downloadUpdate };
      break;
    case "downloading": {
      const pct = Math.round(updater.percent);
      status =
        pct < 1
          ? `Starting download of v${updater.version}…`
          : `Downloading v${updater.version} — ${pct}%`;
      break;
    }
    case "ready-to-install":
      status = `v${updater.version} downloaded and ready to install.`;
      action = {
        label: "Restart to install",
        onClick: async () => {
          const res = await triggerUpdateInstall();
          if (!res.ok && academy?.downloadUrl) openBrowserDownload();
        },
      };
      break;
    case "error":
      if (academyHasUpdate && latest && academy?.downloadUrl) {
        status = `Automatic update hit a download error. New version v${latest} is available.`;
        action = {
          label: "Update",
          onClick: checkForUpdate,
        };
      } else {
        status = `Auto-update unavailable (${updater.message}).`;
        // Always offer a retry path so the user isn't stranded.
        action = { label: "Try again", onClick: () => void triggerUpdateCheck() };
      }
      break;
    case "unsupported-dev":
      if (academyHasUpdate && latest && academy?.downloadUrl) {
        status = `New version v${latest} can be downloaded manually.`;
        action = { label: "Download", onClick: openBrowserDownload };
        break;
      }
      if (academyLoading) status = "Checking for updates…";
      else if (academyError) status = "Couldn't check for updates.";
      else if (!latest) status = "No release information available.";
      else status = "You're on the latest version.";
      break;
    case "idle":
    default:
      if (academyLoading) status = "Checking for updates…";
      else if (academyError) status = "Couldn't check for updates.";
      else if (!latest) status = "No release information available.";
      else if (academyHasUpdate && canTriggerUpdateCheck(updater)) {
        status = `New version v${latest} available.`;
        action = {
          label: "Update",
          onClick: checkForUpdate,
        };
      } else status = "You're on the latest version.";
      break;
  }

  return (
    <SettingsSection title="About" subtitle="Version information for Mission Control.">
      <Field label="Version">
        <div
          aria-busy={busy}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "12px 14px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
              Installed: v{CURRENT_MC_VERSION}
            </div>
            <div
              id={statusId}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}
            >
              {status}
            </div>
          </div>
          {action && (
            <Btn
              variant="ghost"
              size="sm"
              onClick={action.onClick}
              aria-describedby={statusId}
              style={{ flexShrink: 0 }}
            >
              {action.label}
            </Btn>
          )}
        </div>
      </Field>
    </SettingsSection>
  );
}

function ReloadSection() {
  const reload = () => {
    const electron = getElectron();
    if (electron) {
      void electron.reload();
      return;
    }
    if (typeof window === "undefined") return;
    window.location.reload();
  };

  return (
    <SettingsSection title="Reload" subtitle="Refresh the current Mission Control window.">
      <Field label="Window">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "12px 14px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
              Reload app
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
              Applies fresh frontend code and reconnects to the local server.
            </div>
          </div>
          <Btn type="button" variant="solid" size="sm" icon="refresh" onClick={reload}>
            Reload
          </Btn>
        </div>
      </Field>
    </SettingsSection>
  );
}
