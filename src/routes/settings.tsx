import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { SETTINGS_PANEL_IDS } from "~/components/views/SettingsPanel";
import { OPEN_SETTINGS_EVENT, type OpenSettingsEventDetail } from "~/lib/design-meta";

const settingsSearchSchema = z.object({
  panel: z.enum(SETTINGS_PANEL_IDS).optional(),
});

export const Route = createFileRoute("/settings")({
  validateSearch: settingsSearchSchema,
  component: SettingsRoutePage,
});

// Settings is now a Shell-level overlay (see <SettingsPanel> in __root.tsx), not
// a route that swaps out the workspace. This route is kept only as a deep-link
// entry point: a direct visit to /settings opens the overlay on top of Home and
// hands the URL back so the app stays mounted behind it.
function SettingsRoutePage() {
  const router = useRouter();
  const { panel } = Route.useSearch();

  useEffect(() => {
    // Defer past this commit so the Shell's OPEN_SETTINGS_EVENT listener is
    // registered first (child effects fire before parent effects), which matters
    // when the app cold-starts directly on /settings.
    const id = window.setTimeout(() => {
      const detail: OpenSettingsEventDetail = panel ? { panel } : {};
      window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail }));
      void router.navigate({ to: "/", replace: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [panel, router]);

  return null;
}
