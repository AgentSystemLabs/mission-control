import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type AppSettings } from "~/lib/api";
import {
  hasCachedWorktreesPreference,
  readCachedWorktreesEnabled,
  writeCachedWorktreesEnabled,
} from "~/lib/worktrees-preference";
import { queryKeys, useSettings } from "~/queries";
import { Field, SettingsSection, ToggleRow } from "./SettingsParts";

export function BetaSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const [worktreesEnabled, setWorktreesEnabledState] = useState(() =>
    hasCachedWorktreesPreference()
      ? readCachedWorktreesEnabled()
      : (settings?.worktreesEnabled ?? false),
  );

  useEffect(() => {
    if (hasCachedWorktreesPreference()) return;
    if (typeof settings?.worktreesEnabled !== "boolean") return;
    setWorktreesEnabledState(settings.worktreesEnabled);
  }, [settings?.worktreesEnabled]);

  const setWorktreesEnabled = (enabled: boolean) => {
    setWorktreesEnabledState(enabled);
    writeCachedWorktreesEnabled(enabled);
    queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
      current ? { ...current, worktreesEnabled: enabled } : current,
    );
    void api
      .updateSettings({ worktreesEnabled: enabled })
      .then((next) => {
        queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
          current
            ? { ...current, ...next, worktreesEnabled: enabled }
            : { ...next, worktreesEnabled: enabled },
        );
      })
      .catch((error) => {
        console.error("[settings] failed to sync worktrees preference:", error);
      });
  };

  return (
    <SettingsSection
      title="Beta"
      subtitle="Experimental features that may change or be removed."
      headingLevel="h1"
    >
      <Field label="Worktrees">
        <ToggleRow
          title="Git worktrees"
          description="Create isolated worktrees per project for parallel agent sessions. Each worktree gets its own task board and terminals."
          checked={worktreesEnabled}
          onChange={setWorktreesEnabled}
          label="Enable"
        />
      </Field>
    </SettingsSection>
  );
}
