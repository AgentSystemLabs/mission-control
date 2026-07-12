import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  SETTINGS_PANEL_IDS,
  type SettingsPanelId,
} from "~/components/views/settings-panel-ids";
import { OPEN_SETTINGS_EVENT, type OpenSettingsEventDetail } from "~/lib/design-meta";

// Hand-rolled to keep zod out of the eager entry chunk: this route's
// validateSearch was the only client-side zod import, and pulling the library in
// for a single optional enum cost ~40 KB raw in the entry bundle.
function validateSettingsSearch(
  search: Record<string, unknown>,
): { panel?: SettingsPanelId } {
  const panel = search.panel;
  return typeof panel === "string" &&
    (SETTINGS_PANEL_IDS as readonly string[]).includes(panel)
    ? { panel: panel as SettingsPanelId }
    : {};
}

export const Route = createFileRoute("/settings")({
  validateSearch: validateSettingsSearch,
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
