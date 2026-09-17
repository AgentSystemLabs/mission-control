import { useCallback, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ContextMenuPopover } from "~/components/ui/ContextMenuPopover";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/DropdownMenuItem";
import { api, type AppSettings } from "~/lib/api";
import { OPEN_SETTINGS_EVENT, type OpenSettingsEventDetail } from "~/lib/design-meta";
import { queryKeys } from "~/queries";
import {
  normalizeSessionHeaderButtonVisibility,
  type SessionHeaderButtonKey,
} from "~/shared/session-header-buttons";
import {
  DEFAULT_HEADER_BUTTON_VISIBILITY,
  type HeaderButtonKey,
} from "~/shared/header-buttons";

/**
 * The hideable-elements registry: every optional UI element that Settings →
 * Interface can show/hide. Each render site attaches `hideElementContextMenu`
 * from `useHideableMenu`, so "right-click → Hide" and the settings toggles
 * always drive the same persisted setting.
 */
export type HideableElementId =
  | "group-switcher"
  | "project-header-group"
  | "provider-usage"
  | `session-button:${SessionHeaderButtonKey}`
  | `header-button:${HeaderButtonKey}`;

type UiVisibilityPatch = Partial<
  Pick<
    AppSettings,
    | "showGroupSwitcher"
    | "showProjectHeaderGroup"
    | "providerUsageEnabled"
    | "sessionHeaderButtons"
    | "headerButtons"
  >
>;

const SESSION_BUTTON_LABELS: Record<SessionHeaderButtonKey, string> = {
  rename: "rename button",
  zoom: "zoom buttons",
  clone: "clone button",
  focus: "focus button",
  expand: "expand button",
};

const HEADER_BUTTON_LABELS: Record<HeaderButtonKey, string> = {
  scratchPad: "scratch pads button",
  promptSearch: "prompt search button",
  voice: "push-to-talk button",
  notifications: "notifications bell",
  screenshot: "screenshot button",
  gridView: "grid view button",
  fileFinder: "find file button",
};

function elementFor(id: HideableElementId): {
  label: string;
  visibilityPatch: (settings: AppSettings | undefined, visible: boolean) => UiVisibilityPatch;
} {
  if (id === "group-switcher") {
    return {
      label: "group switcher",
      visibilityPatch: (_settings, visible) => ({ showGroupSwitcher: visible }),
    };
  }
  if (id === "project-header-group") {
    return {
      label: "project group tag",
      visibilityPatch: (_settings, visible) => ({ showProjectHeaderGroup: visible }),
    };
  }
  if (id === "provider-usage") {
    // The usage chip has no separate visibility flag: showing it IS the feature
    // toggle (hiding it also stops the polling), so Hide drives that one key.
    return {
      label: "AI usage indicator",
      visibilityPatch: (_settings, visible) => ({ providerUsageEnabled: visible }),
    };
  }
  if (id.startsWith("header-button:")) {
    const key = id.slice("header-button:".length) as HeaderButtonKey;
    return {
      label: HEADER_BUTTON_LABELS[key],
      visibilityPatch: (settings, visible) => ({
        headerButtons: {
          ...(settings?.headerButtons ?? DEFAULT_HEADER_BUTTON_VISIBILITY),
          [key]: visible,
        },
      }),
    };
  }
  const key = id.slice("session-button:".length) as SessionHeaderButtonKey;
  return {
    label: SESSION_BUTTON_LABELS[key],
    visibilityPatch: (settings, visible) => ({
      sessionHeaderButtons: {
        ...normalizeSessionHeaderButtonVisibility(settings?.sessionHeaderButtons),
        [key]: visible,
      },
    }),
  };
}

/**
 * Optimistically write a UI-visibility settings patch and sync it to the
 * server, rolling back the cache on failure. Shared by the Interface settings
 * page toggles and the right-click Hide menu.
 */
export function useUpdateUiVisibility() {
  const queryClient = useQueryClient();
  return useCallback(
    (patch: UiVisibilityPatch) => {
      const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
      if (previous) {
        queryClient.setQueryData<AppSettings>(queryKeys.settings, { ...previous, ...patch });
      }
      void api
        .updateSettings(patch)
        .then((next) => {
          queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
            current ? { ...current, ...next, ...patch } : { ...next, ...patch },
          );
        })
        .catch((error) => {
          // Revert only the keys this call touched — a concurrent settings
          // write (another toggle, another pane's Hide) may have landed after
          // our snapshot, and a full-object restore would erase it from the
          // cache even though it persisted server-side.
          if (previous) {
            const reverted = Object.fromEntries(
              Object.keys(patch).map((key) => [key, previous[key as keyof AppSettings]]),
            );
            queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
              current ? { ...current, ...reverted } : current,
            );
          }
          toast.error(
            error instanceof Error ? error.message : "Could not save interface settings",
          );
        });
    },
    [queryClient],
  );
}

/**
 * Right-click → Hide for registry elements. A component calls this once, spreads
 * `onContextMenu: hideElementContextMenu(id)` onto each hideable element it
 * renders, and mounts `hideableMenu` at the end of its tree.
 */
export function useHideableMenu(): {
  hideElementContextMenu: (id: HideableElementId) => (e: ReactMouseEvent) => void;
  hideableMenu: ReactNode;
} {
  const queryClient = useQueryClient();
  const updateVisibility = useUpdateUiVisibility();
  const [menu, setMenu] = useState<{ id: HideableElementId; x: number; y: number } | null>(null);
  const close = useCallback(() => setMenu(null), []);

  const hideElementContextMenu = useCallback(
    (id: HideableElementId) => (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ id, x: e.clientX, y: e.clientY });
    },
    [],
  );

  let hideableMenu: ReactNode = null;
  if (menu) {
    const element = elementFor(menu.id);
    const hide = () => {
      const settings = queryClient.getQueryData<AppSettings>(queryKeys.settings);
      updateVisibility(element.visibilityPatch(settings, false));
      close();
      toast(`Hid the ${element.label}`, {
        description: "Bring it back any time in Settings → Interface.",
        action: {
          label: "Undo",
          // Rebuild the restore patch from the live cache at undo time — the
          // toast can outlive other hides, and a patch frozen at hide time
          // would resurrect them (session-button patches carry the whole map).
          onClick: () =>
            updateVisibility(
              element.visibilityPatch(
                queryClient.getQueryData<AppSettings>(queryKeys.settings),
                true,
              ),
            ),
        },
      });
    };
    const openInterfaceSettings = () => {
      close();
      const detail: OpenSettingsEventDetail = { panel: "interface" };
      window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail }));
    };
    hideableMenu = (
      <ContextMenuPopover
        anchor={{ x: menu.x, y: menu.y }}
        label={`Hide the ${element.label}`}
        minWidth={210}
        onClose={close}
      >
        <DropdownMenuItem icon="eye-off" autoFocus onClick={hide}>
          Hide {element.label}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon="settings" onClick={openInterfaceSettings}>
          Interface settings…
        </DropdownMenuItem>
      </ContextMenuPopover>
    );
  }

  return { hideElementContextMenu, hideableMenu };
}
