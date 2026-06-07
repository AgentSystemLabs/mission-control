import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { SettingsPanel, SETTINGS_PANEL_IDS, type SettingsPanelId } from "~/components/views/SettingsPanel";
import { closeSettings } from "~/lib/settings-navigation";

const settingsSearchSchema = z.object({
  panel: z.enum(SETTINGS_PANEL_IDS).optional(),
});

export const Route = createFileRoute("/settings")({
  validateSearch: settingsSearchSchema,
  component: SettingsRoutePage,
});

function SettingsRoutePage() {
  const router = useRouter();
  const { panel } = Route.useSearch();

  return (
    <SettingsPanel
      onBack={() => closeSettings(router)}
      initialPanel={(panel ?? "terminal") as SettingsPanelId}
    />
  );
}
