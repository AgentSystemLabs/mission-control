import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { SettingsPanel, type SettingsPanelId } from "~/components/views/SettingsPanel";

const settingsSearchSchema = z.object({
  panel: z
    .enum([
      "general",
      "defaults",
      "terminal",
      "theme",
      "beta",
      "license",
      "keybindings",
      "session-debug",
      "terms",
    ])
    .optional(),
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
      onBack={() => router.navigate({ to: "/" })}
      initialPanel={(panel ?? "terminal") as SettingsPanelId}
    />
  );
}
