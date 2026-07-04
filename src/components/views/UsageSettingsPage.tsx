import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";

type UsagePatch = Partial<
  Pick<
    AppSettings,
    "claudeUsageLimitsEnabled" | "claudeUsageLimitsShowSession" | "claudeUsageLimitsShowWeekly"
  >
>;

export function UsageSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const claudeEnabled = settings?.claudeUsageLimitsEnabled ?? false;
  const claudeShowSession = settings?.claudeUsageLimitsShowSession ?? true;
  const claudeShowWeekly = settings?.claudeUsageLimitsShowWeekly ?? true;

  const update = async (patch: UsagePatch) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.settings });
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    if (previous) {
      queryClient.setQueryData<AppSettings>(queryKeys.settings, { ...previous, ...patch });
    }
    try {
      const next = await api.updateSettings(patch);
      queryClient.setQueryData(queryKeys.settings, next);
    } catch (e) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      toast.error(e instanceof Error ? e.message : "Could not update usage settings");
    }
  };

  return (
    <SettingsSection
      title="Usage"
      subtitle="Surface your coding-agent usage limits in the top bar. More providers coming soon."
      headingLevel="h1"
    >
      <SettingsSection
        title="Claude Code"
        subtitle="Session (5h) and weekly usage with reset times. Reads your Claude login to fetch usage from Anthropic — off by default."
        headingLevel="h2"
      >
        <ToggleRow
          title="Show usage limits in top bar"
          description="Display Claude Code's rolling 5-hour session and weekly (all models) usage, each with the time it resets."
          checked={claudeEnabled}
          onChange={(next) => void update({ claudeUsageLimitsEnabled: next })}
          label="Show Claude usage limits in top bar"
        />
        <ToggleRow
          title="Session (5h)"
          description="Show the rolling 5-hour session window."
          checked={claudeShowSession}
          disabled={!claudeEnabled}
          onChange={(next) => void update({ claudeUsageLimitsShowSession: next })}
          label="Show session usage"
        />
        <ToggleRow
          title="Weekly"
          description="Show the weekly (all models) window."
          checked={claudeShowWeekly}
          disabled={!claudeEnabled}
          onChange={(next) => void update({ claudeUsageLimitsShowWeekly: next })}
          label="Show weekly usage"
        />
      </SettingsSection>
    </SettingsSection>
  );
}
