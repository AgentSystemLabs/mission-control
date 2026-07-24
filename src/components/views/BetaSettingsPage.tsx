import { useQueryClient } from "@tanstack/react-query";
import { api, type AppSettings } from "~/lib/api";
import { isElectron } from "~/lib/electron";
import { queryKeys, useSandboxes, useSettings } from "~/queries";
import { Field, SettingsSection, ToggleRow } from "./SettingsParts";

export function BetaSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const { data: scopes } = useSandboxes();

  const setQuestionOverlayEnabled = (enabled: boolean) => {
    queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
      current ? { ...current, questionOverlayEnabled: enabled } : current,
    );
    void api
      .updateSettings({ questionOverlayEnabled: enabled })
      .then((next) => {
        queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
          current
            ? { ...current, ...next, questionOverlayEnabled: enabled }
            : { ...next, questionOverlayEnabled: enabled },
        );
      })
      .catch((error) => {
        console.error("[settings] failed to sync question overlay preference:", error);
      });
  };

  const setVoiceControlEnabled = (enabled: boolean) => {
    queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
      current ? { ...current, voiceControlEnabled: enabled } : current,
    );
    void api
      .updateSettings({ voiceControlEnabled: enabled })
      .then((next) => {
        queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
          current
            ? { ...current, ...next, voiceControlEnabled: enabled }
            : { ...next, voiceControlEnabled: enabled },
        );
      })
      .catch((error) => {
        console.error("[settings] failed to sync voice preference:", error);
      });
  };

  const setShowGroupBadge = (enabled: boolean) => {
    queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
      current ? { ...current, showGroupBadge: enabled } : current,
    );
    void api
      .updateSettings({ showGroupBadge: enabled })
      .then((next) => {
        queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
          current
            ? { ...current, ...next, showGroupBadge: enabled }
            : { ...next, showGroupBadge: enabled },
        );
      })
      .catch((error) => {
        console.error("[settings] failed to sync group badge preference:", error);
      });
  };

  return (
    <SettingsSection
      title="Beta"
      subtitle="Experimental features that may change or be removed."
      headingLevel="h1"
    >
      <Field label="Agent questions">
        <ToggleRow
          title="Native question popup"
          description="Answer Claude Code's multiple-choice questions in a popup over the session instead of the terminal menu. Turn off to answer directly in the terminal."
          checked={settings?.questionOverlayEnabled ?? true}
          onChange={setQuestionOverlayEnabled}
          label="Enable"
        />
      </Field>
      {isElectron() && (
        <Field label="Voice control">
          <ToggleRow
            title="Push-to-talk voice commands"
            description="Hold the push-to-talk hotkey (Settings → Keybindings) and speak to drive Mission Control — switch projects, run, ship, open the diff, and start agents. Audio is transcribed locally. See Settings → Voice for the full command list."
            checked={settings?.voiceControlEnabled ?? false}
            onChange={setVoiceControlEnabled}
            label="Enable"
          />
        </Field>
      )}
      {isElectron() && (
        <Field label="Sandboxes">
          <ToggleRow
            title="Show sandbox switcher"
            description="Enable the header scope dropdown so projects can run locally or in a selected sandbox."
            checked={!!scopes?.enabled}
            onChange={(enabled) => {
              void (async () => {
                await api.setSandboxesEnabled(enabled);
                void queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes });
              })();
            }}
            label="Enable"
          />
        </Field>
      )}
      <Field label="Project rail">
        <ToggleRow
          title="Show group badge"
          description="Display the active group name and status indicator at the top of the project rail when a group is selected."
          checked={settings?.showGroupBadge ?? false}
          onChange={setShowGroupBadge}
          label="Enable"
        />
      </Field>
    </SettingsSection>
  );
}
