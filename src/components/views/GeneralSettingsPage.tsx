import { DEFAULT_AGENT_LAUNCHER_CONFIG } from "~/shared/agent-launcher-config";
import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openExternal } from "~/lib/open-external";
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
import { DEFAULT_TERMINAL_ZOOM_LEVEL } from "~/shared/terminal-zoom";
import {
  DEFAULT_INTERFACE_FONT_SCALE,
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  DEFAULT_TERMINAL_LETTER_SPACING,
  DEFAULT_TERMINAL_LINE_HEIGHT,
} from "~/shared/terminal-appearance";
import { DEFAULT_SURFACE_TINT } from "~/shared/surface-tint";
import {
  readOsNotificationPermission,
  requestOsNotificationPermission,
  type OsNotificationPermission,
} from "~/lib/os-notifications";
import { isElectron } from "~/lib/electron";
import { emptyVoiceCommandAliases } from "~/shared/voice-command-aliases";
import { DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY } from "~/shared/session-header-buttons";
import { DEFAULT_SHIP_PROMPT } from "~/shared/ship-defaults";
import {
  DEFAULT_PET_NAME,
  isPetSpeciesUnlocked,
  PET_MAX_LEVEL,
  PET_SIZE_IDS,
  PET_SPECIES_IDS,
  type PetSizeId,
} from "~/shared/pet";
import { petRename, petSetSize, petSetSpecies, usePetSnapshot } from "~/lib/pet/pet-store";
import { PET_SPECIES } from "~/components/pet/PetSprite";
import { TextField } from "~/components/ui/TextField";

export function GeneralSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const mouseGradientEnabled = !(settings?.mouseGradientDisabled ?? false);
  const batterySaverEnabled = settings?.batterySaverEnabled ?? true;
  const toastEnabled = settings?.sessionFinishToastEnabled ?? true;
  const osNotificationEnabled =
    settings?.sessionFinishOsNotificationEnabled ?? false;
  const notificationSoundEnabled = settings?.notificationSoundEnabled ?? true;
  const automaticUpdateDownloadsEnabled =
    settings?.automaticUpdateDownloadsEnabled ?? false;
  const automaticUpdateInstallOnQuitEnabled =
    settings?.automaticUpdateInstallOnQuitEnabled ?? false;
  const [launchOverlayEnabled, setLaunchOverlayEnabledState] = useState(
    () => readCachedLaunchIntroEnabled(),
  );
  const [permission, setPermission] = useState<OsNotificationPermission>("default");
  const [permissionHint, setPermissionHint] = useState<string | null>(null);
  const petEnabled = settings?.petEnabled ?? true;
  const petMessagesEnabled = settings?.petMessagesEnabled ?? true;
  const petSoundsEnabled = settings?.petSoundsEnabled ?? false;
  const petState = settings?.petState ?? null;
  const [petNameDraft, setPetNameDraft] = useState("");

  useEffect(() => {
    setPetNameDraft(petState?.name ?? "");
  }, [petState?.name]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setPermission("unsupported");
      return;
    }
    const refreshPermission = () => {
      void readOsNotificationPermission().then(setPermission);
    };
    refreshPermission();
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
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
        | "batterySaverEnabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "notificationSoundEnabled"
        | "launchOverlayEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
        | "petEnabled"
        | "petMessagesEnabled"
        | "petSoundsEnabled"
      >
    >,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor: settings?.accentColor ?? DEFAULT_ACCENT_COLOR,
    themeStyle: settings?.themeStyle ?? "painted",
    surfaceTint: settings?.surfaceTint ?? DEFAULT_SURFACE_TINT,
    minimalTheme: settings?.minimalTheme ?? false,
    themeChosen: settings?.themeChosen ?? false,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    batterySaverEnabled,
    sessionFinishToastEnabled: toastEnabled,
    sessionFinishOsNotificationEnabled: osNotificationEnabled,
    notificationSoundEnabled,
    launchOverlayEnabled,
    automaticUpdateDownloadsEnabled,
    automaticUpdateInstallOnQuitEnabled,
    gitDiffChangedFilesView: settings?.gitDiffChangedFilesView ?? null,
    gitDiffChangedFilesWidth: settings?.gitDiffChangedFilesWidth ?? null,
    projectsDashboardView: settings?.projectsDashboardView ?? null,
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
    petState: settings?.petState ?? null,
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
    worktreesEnabled: true,
    ...patch,
  });

  const updateSettings = async (
    patch: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "mouseGradientDisabled"
        | "batterySaverEnabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "notificationSoundEnabled"
        | "launchOverlayEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
        | "petEnabled"
        | "petMessagesEnabled"
        | "petSoundsEnabled"
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

  const setBatterySaverEnabled = async (enabled: boolean) => {
    await updateSettings({ batterySaverEnabled: enabled });
  };

  const setToastEnabled = async (sessionFinishToastEnabled: boolean) => {
    await updateSettings({ sessionFinishToastEnabled });
  };

  const setNotificationSoundEnabled = async (enabled: boolean) => {
    await updateSettings({ notificationSoundEnabled: enabled });
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
      const current = await readOsNotificationPermission();
      setPermission(current);
      if (current === "unsupported") {
        setPermissionHint("OS notifications are not supported in this environment.");
        return;
      }
      if (!isElectron()) {
        if (current === "denied") {
          setPermissionHint(
            "Notification permission is blocked. Enable it in your OS or browser settings, then try again.",
          );
          return;
        }
        if (current === "default") {
          const result = await requestOsNotificationPermission();
          setPermission(result);
          if (result !== "granted") {
            setPermissionHint(
              "Notification permission was not granted. Enable it in your OS or browser settings, then try again.",
            );
            return;
          }
        }
      }
    }
    await updateSettings({
      sessionFinishOsNotificationEnabled: enabled,
    });
  };

  const osNotificationBlocked =
    osNotificationEnabled &&
    permission !== "unsupported" &&
    permission !== "granted";
  const osNotificationStatusMessage =
    permissionHint ??
    (osNotificationBlocked && permission === "denied" && !isElectron()
      ? "Notification permission is blocked. On macOS, open System Settings → Notifications → Mission Control, allow notifications, then reload Mission Control."
      : osNotificationBlocked && permission === "default" && !isElectron()
        ? "Notification permission is not granted yet. Turn this toggle off and on again to approve the prompt."
        : null);

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
        <Field label="Battery saver">
          <ToggleRow
            title="Reduce energy use on battery"
            description="On battery power, decorative animations freeze, terminal cursors stop blinking, and idle refresh slows down."
            checked={batterySaverEnabled}
            onChange={setBatterySaverEnabled}
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
        <Field label="Sound">
          <ToggleRow
            title="Notification sound"
            description="Play a short ding when a session finishes or a diagram is ready."
            checked={notificationSoundEnabled}
            onChange={setNotificationSoundEnabled}
            label="Play sound"
          />
        </Field>
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
                : isElectron()
                  ? "Uses macOS notifications through Electron. Control badges, sounds, and banners in System Settings → Notifications → Electron."
                  : "A native OS notification appears so you see it even when the app is in the background."
            }
            checked={osNotificationEnabled}
            onChange={setOsNotificationEnabled}
            disabled={permission === "unsupported"}
            label="Enable"
          />
          {osNotificationStatusMessage && (
            <div
              role="status"
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--text-dim)",
                lineHeight: 1.45,
              }}
            >
              {osNotificationStatusMessage}
            </div>
          )}
        </Field>
      </SettingsSection>
      <SettingsSection
        title="Mission Pet"
        subtitle="An ambient companion that reacts to real agent activity — no care chores, your work is its life."
      >
        <Field label="Pet">
          <ToggleRow
            title="Show pet"
            description="A small companion lives in the bottom-right corner: it works when your agents work, celebrates finished sessions, and hops when one is blocked on you."
            checked={petEnabled}
            onChange={(enabled: boolean) => void updateSettings({ petEnabled: enabled })}
            label="Enable"
          />
        </Field>
        <Field label="Speech bubbles">
          <ToggleRow
            title="Commentary"
            description="One-liners on real events — finished sessions, ships, blocked agents. Rate-limited so it stays charming."
            checked={petMessagesEnabled}
            onChange={(enabled: boolean) => void updateSettings({ petMessagesEnabled: enabled })}
            disabled={!petEnabled}
            label="Enable"
          />
        </Field>
        <Field label="Sounds">
          <ToggleRow
            title="Level-up chime"
            description="A soft chime when the pet levels up. XP comes only from finished sessions, ships, and PRs."
            checked={petSoundsEnabled}
            onChange={(enabled: boolean) => void updateSettings({ petSoundsEnabled: enabled })}
            disabled={!petEnabled}
            label="Enable"
          />
        </Field>
        {petEnabled && petState ? (
          <Field label="Species">
            <PetSpeciesPicker />
          </Field>
        ) : null}
        {petEnabled && petState ? (
          <Field label="Size">
            <PetSizePicker />
          </Field>
        ) : null}
        {petEnabled && petState ? (
          <Field label="Identity">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <TextField
                label="Name"
                value={petNameDraft}
                onChange={setPetNameDraft}
                onBlur={() => {
                  // Rename through the store so the live pet updates and the
                  // controller persists it (a direct settings write would be
                  // overwritten by the store's next debounced save).
                  if (petNameDraft.trim()) petRename(petNameDraft);
                  else setPetNameDraft(petState.name);
                }}
                placeholder={DEFAULT_PET_NAME}
                spellCheck={false}
              />
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
                Lv {petState.level} · {petState.xp} XP
                {petState.prestige > 0 ? ` · ★${petState.prestige} molt${petState.prestige === 1 ? "" : "s"}` : ""}
                {petState.level >= PET_MAX_LEVEL
                  ? " · max level — right-click the pet to molt"
                  : ""}
                <span style={{ margin: "0 6px", opacity: 0.5 }}>—</span>
                Snark {petState.personality.snark} · Wisdom {petState.personality.wisdom} ·
                Chaos {petState.personality.chaos} · Zen {petState.personality.zen}
                <span style={{ margin: "0 6px", opacity: 0.5 }}>—</span>
                personality is rolled once per install
              </div>
            </div>
          </Field>
        ) : null}
      </SettingsSection>
      <AboutSection />
      <ReloadSection />
    </>
  );
}

/**
 * Live species picker — each option renders that species' actual idle sprite,
 * so what you pick is exactly what wanders the corner. Selection goes through
 * the pet store (petSetSpecies) so the live pet switches instantly and the
 * controller persists it with the rest of the identity.
 */
function PetSpeciesPicker() {
  const pet = usePetSnapshot();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="radiogroup" aria-label="Pet species">
      {PET_SPECIES_IDS.map((id) => {
        const species = PET_SPECIES[id];
        const selected = pet.species === id;
        // Ember is earned, not picked: locked until the pet has molted.
        const locked = !isPetSpeciesUnlocked(id, pet.prestige);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={locked || undefined}
            disabled={locked}
            title={
              locked
                ? "Unlocks after your pet molts — reach level 10, then choose “Molt” on its stats card"
                : undefined
            }
            onClick={() => petSetSpecies(id)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: "8px 10px 6px",
              borderRadius: 10,
              cursor: locked ? "not-allowed" : "pointer",
              background: selected
                ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                : "transparent",
              border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
              color: selected ? "var(--text)" : "var(--text-dim)",
              opacity: locked ? 0.45 : 1,
            }}
          >
            <span style={{ filter: locked ? "grayscale(1)" : undefined, lineHeight: 0 }}>
              <species.Sprite mood="idle" intensity={1} night={false} level={1} size={44} />
            </span>
            <span style={{ fontSize: 11 }}>{locked ? `${species.label} 🔒` : species.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const PET_SIZE_LABELS: Record<PetSizeId, string> = { s: "Small", m: "Medium", l: "Large" };
/** Preview sprite sizes — the same S/M/L ratio the corner widget renders at. */
const PET_SIZE_PREVIEW_PX: Record<PetSizeId, number> = { s: 34, m: 44, l: 56 };

/**
 * Size picker in the species-picker style: each option shows the current
 * species' idle sprite at that size's scale. Selection goes through the pet
 * store (petSetSize) so the live pet resizes instantly and the controller
 * persists it with the rest of the identity.
 */
function PetSizePicker() {
  const pet = usePetSnapshot();
  const species = PET_SPECIES[pet.species];
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      role="radiogroup"
      aria-label="Pet size"
    >
      {PET_SIZE_IDS.map((id) => {
        const selected = pet.size === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => petSetSize(id)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 2,
              minWidth: 76,
              padding: "8px 10px 6px",
              borderRadius: 10,
              cursor: "pointer",
              background: selected
                ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                : "transparent",
              border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
              color: selected ? "var(--text)" : "var(--text-dim)",
            }}
          >
            <species.Sprite
              mood="idle"
              intensity={1}
              night={false}
              level={1}
              size={PET_SIZE_PREVIEW_PX[id]}
            />
            <span style={{ fontSize: 11 }}>{PET_SIZE_LABELS[id]}</span>
          </button>
        );
      })}
    </div>
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
    else openExternal(academy.downloadUrl);
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
