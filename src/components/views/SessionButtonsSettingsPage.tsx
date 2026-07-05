import { useQueryClient } from "@tanstack/react-query";
import { Field, SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import {
  DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY,
  SESSION_HEADER_BUTTON_KEYS,
  type SessionHeaderButtonKey,
  type SessionHeaderButtonVisibility,
} from "~/shared/session-header-buttons";

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
};

export function SessionButtonsSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const visibility = settings?.sessionHeaderButtons ?? DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY;

  const setVisibility = async (next: SessionHeaderButtonVisibility) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    if (previous) {
      queryClient.setQueryData<AppSettings>(queryKeys.settings, {
        ...previous,
        sessionHeaderButtons: next,
      });
    }
    try {
      const updated = await api.updateSettings({ sessionHeaderButtons: next });
      queryClient.setQueryData(queryKeys.settings, updated);
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  const toggle = (key: SessionHeaderButtonKey, checked: boolean) => {
    void setVisibility({ ...visibility, [key]: checked });
  };

  return (
    <SettingsSection
      title="Session buttons"
      subtitle="Choose which action buttons appear in a session pane's header. Hidden actions stay available through keyboard shortcuts."
      headingLevel="h1"
    >
      <Field label="Header actions">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SESSION_HEADER_BUTTON_KEYS.map((key) => {
            const meta = BUTTON_META[key];
            return (
              <ToggleRow
                key={key}
                title={meta.title}
                description={meta.description}
                checked={visibility[key]}
                onChange={(next) => toggle(key, next)}
                label={meta.label}
              />
            );
          })}
        </div>
      </Field>
    </SettingsSection>
  );
}
