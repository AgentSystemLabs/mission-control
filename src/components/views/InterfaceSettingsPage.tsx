import { Field, SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { useUpdateUiVisibility } from "~/lib/hideable-elements";
import { useSettings } from "~/queries";
import {
  normalizeSessionHeaderButtonVisibility,
  SESSION_HEADER_BUTTON_KEYS,
  type SessionHeaderButtonKey,
} from "~/shared/session-header-buttons";
import {
  DEFAULT_HEADER_BUTTON_VISIBILITY,
  type HeaderButtonKey,
} from "~/shared/header-buttons";

const BUTTON_META: Record<
  SessionHeaderButtonKey,
  { title: string; description: string; label: string }
> = {
  rename: {
    title: "Rename session",
    description: "The pencil button that opens the rename dialog for a session pane.",
    label: "Show rename button",
  },
  zoom: {
    title: "Zoom in / out",
    description:
      "The terminal text zoom buttons. Hidden by default — zoom with Cmd/Ctrl and + / − / 0 instead.",
    label: "Show zoom buttons",
  },
  clone: {
    title: "Clone session",
    description: "The copy button that duplicates a session into a new pane.",
    label: "Show clone button",
  },
  focus: {
    title: "Focus session",
    description: "The pin button that pops a session out into a floating focus window.",
    label: "Show focus button",
  },
  expand: {
    title: "Expand session panel",
    description:
      "The maximize button that expands a session pane. Hidden here, the panel still toggles with its hotkey (Cmd/Ctrl K).",
    label: "Show expand button",
  },
};

const HEADER_BUTTON_META: Record<
  HeaderButtonKey,
  { title: string; description: string; label: string }
> = {
  scratchPad: {
    title: "Scratch pads",
    description:
      "The notepad button in the top-bar tools tray. Hidden here, scratch pads still open with their hotkey.",
    label: "Show scratch pads button",
  },
  promptSearch: {
    title: "Prompt search",
    description:
      "The prompt-history search button in the top-bar tools tray. The search palette keeps its hotkey.",
    label: "Show prompt search button",
  },
  voice: {
    title: "Push-to-talk",
    description:
      "The microphone button in the top-bar tools tray (only shown while voice control is on). Push-to-talk keeps its hotkey.",
    label: "Show push-to-talk button",
  },
  notifications: {
    title: "Notifications bell",
    description:
      "The bell in the top bar listing finished sessions and ready diagrams. It has no hotkey — while hidden, finish toasts and OS notifications are the only alert.",
    label: "Show notifications bell",
  },
  screenshot: {
    title: "Screenshot",
    description:
      "The camera button in an open project's header (macOS region capture). Capture keeps its hotkey.",
    label: "Show screenshot button",
  },
  gridView: {
    title: "Grid view",
    description:
      "The button in an open project's header that shows every session at once. Grid view keeps its hotkey.",
    label: "Show grid view button",
  },
  fileFinder: {
    title: "Find file",
    description:
      "The file-search button in an open project's header. The finder keeps its hotkey.",
    label: "Show find file button",
  },
};

/**
 * The single home for every show/hide toggle in the UI. Each element listed
 * here is also hideable in place: right-click it in the app and choose Hide
 * (see `useHideableMenu` in ~/lib/hideable-elements).
 */
export function InterfaceSettingsPage() {
  const { data: settings } = useSettings();
  const update = useUpdateUiVisibility();
  const visibility = normalizeSessionHeaderButtonVisibility(settings?.sessionHeaderButtons);
  const headerButtons = settings?.headerButtons ?? DEFAULT_HEADER_BUTTON_VISIBILITY;

  const headerButtonRow = (key: HeaderButtonKey) => {
    const meta = HEADER_BUTTON_META[key];
    return (
      <ToggleRow
        key={key}
        title={meta.title}
        description={meta.description}
        checked={headerButtons[key]}
        onChange={(next) => update({ headerButtons: { ...headerButtons, [key]: next } })}
        label={meta.label}
      />
    );
  };

  return (
    <SettingsSection
      title="Interface"
      subtitle="Choose which UI elements are shown. You can also right-click any of these elements in the app and pick Hide. Hidden actions stay available through keyboard shortcuts."
      headingLevel="h1"
    >
      <Field label="Top bar">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ToggleRow
            title="Group switcher pill"
            description="The active-group pill (colored dot + group name) leading the top bar breadcrumb. While hidden, switch groups with the dashboard chips or the group-cycle hotkey."
            checked={settings?.showGroupSwitcher ?? true}
            onChange={(next) => update({ showGroupSwitcher: next })}
            label="Show group switcher pill"
          />
          <ToggleRow
            title="AI usage indicator"
            description="The provider-usage chip (ring or status dots) in the top bar. Hiding it also stops the usage polling — the same switch as Settings → Usage, where you pick which providers it covers."
            checked={settings?.providerUsageEnabled ?? false}
            onChange={(next) => update({ providerUsageEnabled: next })}
            label="Show AI usage indicator"
          />
          {headerButtonRow("scratchPad")}
          {headerButtonRow("promptSearch")}
          {headerButtonRow("voice")}
          {headerButtonRow("notifications")}
        </div>
      </Field>
      <Field label="Project header">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ToggleRow
            title="Group tag"
            description="The group tag (colored dot + group name) in an open project's header, showing which group it belongs to. Click it to scope the dashboard to that group."
            checked={settings?.showProjectHeaderGroup ?? true}
            onChange={(next) => update({ showProjectHeaderGroup: next })}
            label="Show project group tag"
          />
          {headerButtonRow("screenshot")}
          {headerButtonRow("gridView")}
          {headerButtonRow("fileFinder")}
        </div>
      </Field>
      <Field label="Session header buttons">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SESSION_HEADER_BUTTON_KEYS.map((key) => {
            const meta = BUTTON_META[key];
            return (
              <ToggleRow
                key={key}
                title={meta.title}
                description={meta.description}
                checked={visibility[key]}
                onChange={(next) => update({ sessionHeaderButtons: { ...visibility, [key]: next } })}
                label={meta.label}
              />
            );
          })}
        </div>
      </Field>
    </SettingsSection>
  );
}
