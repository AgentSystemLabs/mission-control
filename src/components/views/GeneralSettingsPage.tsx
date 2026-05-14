import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import {
  CURRENT_MC_VERSION,
  useLatestMissionControlVersion,
} from "~/queries/mission-control-version";
import { DEFAULT_ACCENT_COLOR } from "~/lib/accent-colors";

export function GeneralSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const disabled = settings?.agentSystemBannerDisabled ?? false;
  const mouseGradientEnabled = !(settings?.mouseGradientDisabled ?? false);
  const toastEnabled = settings?.sessionFinishToastEnabled ?? true;
  const osNotificationEnabled =
    settings?.sessionFinishOsNotificationEnabled ?? false;
  const launchAudioEnabled = !(settings?.launchAudioDisabled ?? false);
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

  const optimisticSettings = (
    patch: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "mouseGradientDisabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "launchAudioDisabled"
      >
    >,
  ): AppSettings => ({
    agentSystemBannerDisabled: disabled,
    accentColor: settings?.accentColor ?? DEFAULT_ACCENT_COLOR,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    sessionFinishToastEnabled: toastEnabled,
    sessionFinishOsNotificationEnabled: osNotificationEnabled,
    launchAudioDisabled: settings?.launchAudioDisabled ?? false,
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
        | "launchAudioDisabled"
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

  const setBannerDisabled = async (agentSystemBannerDisabled: boolean) => {
    await updateSettings({ agentSystemBannerDisabled });
  };

  const setMouseGradientEnabled = async (enabled: boolean) => {
    await updateSettings({ mouseGradientDisabled: !enabled });
  };

  const setToastEnabled = async (sessionFinishToastEnabled: boolean) => {
    await updateSettings({ sessionFinishToastEnabled });
  };

  const setLaunchAudioEnabled = async (enabled: boolean) => {
    await updateSettings({ launchAudioDisabled: !enabled });
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
        <Field label="AgentSystem.dev banner">
          <ToggleRow
            title="Show promotional banner"
            description="Dismissing the banner only hides it until the app reloads."
            checked={!disabled}
            onChange={(enabled) => void setBannerDisabled(!enabled)}
            label="Show banner"
          />
        </Field>
        <Field label="Mouse gradient">
          <ToggleRow
            title="Show mouse gradient"
            description="Cursor and card gradients follow the pointer across the workspace."
            checked={mouseGradientEnabled}
            onChange={setMouseGradientEnabled}
            label="Enable"
          />
        </Field>
        <Field label="Loading screen sound effects">
          <ToggleRow
            title="Play launch sound effects"
            description="Welcome chime and airlock slide play while the loading screen is visible."
            checked={launchAudioEnabled}
            onChange={setLaunchAudioEnabled}
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
    </>
  );
}

function AboutSection() {
  const { data, isLoading, isError } = useLatestMissionControlVersion();
  const latest = data?.latestVersion;
  const updateAvailable = !!data?.isUpdateAvailable;

  let status: string;
  if (isLoading) status = "Checking for updates…";
  else if (isError) status = "Couldn't check for updates.";
  else if (!latest) status = "No release information available.";
  else if (updateAvailable) status = `New version v${latest} available.`;
  else status = "You're on the latest version.";

  return (
    <SettingsSection title="About" subtitle="Version information for Mission Control.">
      <Field label="Version">
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
              Installed: v{CURRENT_MC_VERSION}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
              {status}
            </div>
          </div>
          {updateAvailable && data?.downloadUrl && (
            <a
              href={data.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--accent)",
                textDecoration: "none",
                flexShrink: 0,
              }}
            >
              Download →
            </a>
          )}
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
  const [focused, setFocused] = useState(false);

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
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        aria-labelledby={`${titleId} ${labelId}`}
        aria-describedby={descriptionId}
        onClick={() => onChange(!checked)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "var(--text-dim)",
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "relative",
            display: "inline-flex",
            width: 34,
            height: 20,
            padding: 2,
            border: `1px solid ${checked ? "var(--accent-border)" : "var(--border-strong)"}`,
            borderRadius: 999,
            background: checked ? "var(--accent-dim)" : "var(--surface-2)",
            opacity: disabled ? 0.7 : 1,
            boxShadow: focused ? "0 0 0 2px var(--accent-glow)" : "none",
            transition:
              "background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: checked ? 17 : 3,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: checked ? "var(--accent)" : "var(--text-faint)",
              boxShadow: checked ? "0 0 8px var(--accent-glow)" : "none",
              transition: "left 0.15s ease, background 0.15s ease, box-shadow 0.15s ease",
            }}
          />
        </span>
        <span id={labelId}>{label}</span>
      </button>
    </div>
  );
}
