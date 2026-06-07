import type { RegisteredRouter } from "@tanstack/react-router";
import type { SettingsPanelId } from "~/components/views/SettingsPanel";
import { CLOSE_SETTINGS_EVENT } from "~/lib/design-meta";

type SettingsReturnLocation = {
  pathname: string;
  search: Record<string, unknown>;
};

let returnLocation: SettingsReturnLocation | null = null;

export function rememberSettingsReturnLocation(pathname: string, search: unknown) {
  if (pathname === "/settings") return;
  returnLocation = {
    pathname,
    search: (search ?? {}) as Record<string, unknown>,
  };
}

export function closeSettings(router: RegisteredRouter) {
  const returnTo = returnLocation;
  returnLocation = null;

  if (!returnTo) {
    void router.navigate({ to: "/" });
    return;
  }

  const projectMatch = returnTo.pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch) {
    void router.navigate({
      to: "/projects/$id",
      params: { id: projectMatch[1]! },
      search: returnTo.search,
    });
    return;
  }

  void router.navigate({ to: "/", search: returnTo.search });
}

export function openSettingsRoute(router: RegisteredRouter, panel?: SettingsPanelId) {
  rememberSettingsReturnLocation(
    router.state.location.pathname,
    router.state.location.search,
  );
  void router.navigate({
    to: "/settings",
    ...(panel ? { search: { panel } } : {}),
  });
}

export function isSettingsRouteOpen(router: RegisteredRouter) {
  return router.state.location.pathname === "/settings";
}

export function requestCloseSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLOSE_SETTINGS_EVENT));
}

export function toggleSettingsRoute(router: RegisteredRouter) {
  if (isSettingsRouteOpen(router)) {
    requestCloseSettings();
    return;
  }
  openSettingsRoute(router);
}
