import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import { getElectron } from "~/lib/electron";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import {
  CURRENT_MC_VERSION,
  useLatestMissionControlVersion,
} from "~/queries/mission-control-version";
import {
  triggerUpdateCheck,
  triggerUpdateInstall,
  useAutoUpdaterState,
} from "~/queries/mc-auto-updater";
import { DEFAULT_ACCENT_COLOR } from "~/lib/accent-colors";
import {
  hasCachedLaunchIntroPreference,
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
    if (hasCachedLaunchIntroPreference()) return;
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
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
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
    updater.kind === "available" ||
    updater.kind === "downloading";

  switch (updater.kind) {
    case "priming":
      status = "Checking for updates…";
      break;
    case "checking":
      status = "Checking for updates…";
      break;
    case "available":
      status = `Update v${updater.version} found — downloading…`;
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
        status = `Auto-update unavailable. New version v${latest} can be downloaded manually.`;
        action = { label: "Download", onClick: openBrowserDownload };
      } else {
        status = `Auto-update unavailable (${updater.message}).`;
        // Always offer a retry path so the user isn't stranded.
        action = { label: "Try again", onClick: () => void triggerUpdateCheck() };
      }
      break;
    case "unsupported-dev":
    case "idle":
    default:
      if (academyLoading) status = "Checking for updates…";
      else if (academyError) status = "Couldn't check for updates.";
      else if (!latest) status = "No release information available.";
      else if (academyHasUpdate) {
        status = `New version v${latest} available.`;
        action = {
          label: "Update",
          onClick: async () => {
            try {
              await triggerUpdateCheck();
            } catch (err) {
              console.error("[updater] check failed; falling through to browser:", err);
              openBrowserDownload();
            }
          },
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

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  label,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const labelId = useId();

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
        borderRadius: 7,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div>
        <div
          id={titleId}
          style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}
        >
          {title}
        </div>
        <div
          id={descriptionId}
          style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}
        >
          {description}
        </div>
      </div>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "var(--text-dim)",
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-labelledby={`${titleId} ${labelId}`}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span id={labelId}>{label}</span>
      </label>
    </div>
  );
}
