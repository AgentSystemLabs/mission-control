import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  ClientOnly,
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { getRailProjects } from "~/lib/rail-projects";
import { getElectron } from "~/lib/electron";
import { isFocusPath } from "~/lib/focus-session";
import { screenshotSupported } from "~/lib/screenshot";
import { TopBar, type Crumb } from "~/components/ui/TopBar";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
import { KeybindingsProvider } from "~/lib/keybindings/store";
import { useNavigationSwipe } from "~/lib/use-navigation-swipe";
import { THEME_CACHE_KEY, useTheme } from "~/lib/use-theme";
import { usePowerSaveController } from "~/lib/power-save";
import { useWindowIdleController } from "~/lib/window-idle";
import {
  TerminalProvider,
  useTerminals,
  useTerminalActions,
  useGridView,
  useHasActiveSession,
} from "~/lib/terminal-store";
import { Z_INDEX } from "~/lib/z-index";
import { DEFAULT_PET_HOME_SIDE } from "~/shared/pet";
import {
  UserTerminalProvider,
  useUserTerminals,
} from "~/lib/user-terminal-store";
import { TerminalPanel } from "~/components/views/TerminalPanel";
import { SessionFileDropZone } from "~/components/views/SessionDropzone";
import { UserTerminalPanel } from "~/components/views/UserTerminalPanel";
import { ProjectPicker } from "~/components/views/ProjectPicker";
import { ProjectBar } from "~/components/views/ProjectBar";
import { ScreenshotThumbnail } from "~/components/views/ScreenshotThumbnail";
import { AddProjectProvider } from "~/lib/add-project-store";
import { GroupsDialogProvider } from "~/lib/groups-dialog-store";
import { useActiveGroup } from "~/lib/active-group";
import { GroupSwitcher } from "~/components/views/GroupSwitcher";
import { PromptSearchProvider } from "~/lib/prompt-search-store";
import { PromptSearchButton } from "~/components/views/PromptSearchButton";
import {
  HeaderActionsProvider,
  HeaderActionsSlot,
  HeaderBeforeSearchSlot,
} from "~/components/ui/HeaderActionsSlot";
import { apiTokenQueryOptions, useSettings, useScopedProjects, useSandboxes } from "~/queries";
import { SandboxResumingOverlay } from "~/components/views/SandboxResumingOverlay";
import { ScopeDropdown } from "~/components/views/ScopeDropdown";
import { UpdateAvailableButton } from "~/components/ui/UpdateAvailableButton";
import { ProviderUsageIndicator } from "~/components/views/ProviderUsageIndicator";
import {
  ACCENT_CACHE_KEY,
  ACCENT_COLORS,
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
} from "~/lib/accent-colors";
import { applyTerminalAppearance } from "~/lib/terminal-appearance";
import {
  applyInterfaceFontFamily,
  applyInterfaceFontScale,
} from "~/lib/interface-appearance";
import {
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  DEFAULT_TERMINAL_LETTER_SPACING,
  DEFAULT_TERMINAL_LINE_HEIGHT,
} from "~/shared/terminal-appearance";
import {
  SETTINGS_PANEL_IDS,
  type SettingsPanelId,
} from "~/components/views/settings-panel-ids";
// Lazy: the settings overlay is conditionally rendered (settingsOpen) inside
// ClientOnly, so hydration never touches it — deferring its module keeps the
// dozen settings pages (and the pet cluster they pin) out of the entry chunk.
const SettingsPanel = lazy(() =>
  import("~/components/views/SettingsPanel").then((m) => ({
    default: m.SettingsPanel,
  })),
);
import { OPEN_SETTINGS_EVENT } from "~/lib/design-meta";
import {
  requestCloseSettings,
  setSettingsOverlayOpen,
} from "~/lib/settings-navigation";

import { UsagePanel } from "~/components/views/UsagePanel";
import { VoiceController } from "~/components/views/VoiceController";
import { VoicePushToTalkButton } from "~/components/views/VoicePushToTalkButton";
import { SessionNotificationsButton } from "~/components/views/SessionNotificationsButton";
import { Toaster } from "sonner";
import { MC_TOAST_CLASS_NAMES, MC_TOAST_CLOSE_ICON } from "~/lib/mc-toast";
import { useSessionFinishNotifications } from "~/lib/use-session-finish-notifications";
// Lazy: the pet controller + widget + multiplayer overlay (and the
// pet-lines/pet-messages/PetSprite payload) load off the entry chunk. Mounted
// as a continuously-present sibling of Shell (see below) so the controller
// survives focus-mode transitions. RemotePets renders inside PetHost.
const PetHost = lazy(() => import("~/components/pet/PetHost"));
import {
  mergeAppNotificationLists,
  useDiagramReadyNotificationList,
} from "~/lib/use-diagram-ready-notifications";
import {
  clearAppNotification,
  clearAppNotifications,
  type AppNotification,
} from "~/lib/session-notification-store";
import { DiagramDialogHost } from "~/lib/use-diagram-events";
import { isUserTerminalXtermFocused, isTerminalXtermFocused, terminalZoomIntentFromKeyboard } from "~/lib/terminal-pane-helpers";
import { useWarmCliAvailability } from "~/lib/cli-availability";
import {
  CLEAR_USER_TERMINAL_EVENT,
  GRID_EXPAND_TOGGLE_EVENT,
  TERMINAL_ZOOM_IN_EVENT,
  TERMINAL_ZOOM_OUT_EVENT,
  TERMINAL_ZOOM_RESET_EVENT,
} from "~/lib/design-meta";
import {
  LAUNCH_INTRO_CACHE_KEY,
  hasCachedLaunchIntroPreference,
  readCachedLaunchIntroEnabled,
  setDocumentLaunchIntroActive,
  writeCachedLaunchIntroEnabled,
} from "~/lib/launch-intro";
import {
  MINIMAL_CACHE_KEY,
  THEME_STYLE_CACHE_KEY,
  applyThemeStyle,
  readCachedThemeStyle,
} from "~/lib/theme-style";
import {
  SURFACE_TINT_CACHE_KEY,
  applySurfaceTint,
} from "~/lib/surface-tint";
import { ThemeOnboardingGate } from "~/components/views/ThemeOnboardingOverlay";
import "~/styles.css";

const LAUNCH_OVERLAY_DURATION_MS = 2700;
const MINIMAL_TOP_BAR_CONTENT_TOP_INSET = 2;
const MINIMAL_WINDOW_DRAG_LAYER_HEIGHT = 8;
const WINDOW_DRAG_LAYER_Z_INDEX = 30;
const useThemeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Pre-hydration script: runs synchronously in <head> before first paint so
// theme state (`data-minimal` + `data-theme` + accent CSS vars) is in place
// before any CSS layout. Without this, the SSR'd HTML paints with default
// (painted+orange, dark) theme for one frame — every accent-tinted surface
// flashes before React/useSettings hydrate, and a flat-light user sees a dark
// flash. Mirrors `applyThemeStyle` (src/lib/theme-style.ts), `useTheme`
// (src/lib/use-theme.ts), `applySurfaceTint` (src/lib/surface-tint.ts) and
// `applyAccentColor` (src/lib/accent-colors.ts); keep them in sync. Legacy
// minimal/noir/ember styles collapse to flat here.
const PRE_HYDRATION_THEME_SCRIPT = `(function(){try{
var d=document.documentElement;
var st=localStorage.getItem(${JSON.stringify(THEME_STYLE_CACHE_KEY)});
if(st!=="painted"&&st!=="flat"&&st!=="minimal"&&st!=="noir"&&st!=="ember"){st=localStorage.getItem(${JSON.stringify(MINIMAL_CACHE_KEY)})==="1"?"flat":"painted";}
var flat=(st!=="painted");
if(flat){d.setAttribute("data-minimal","true");}
var th=localStorage.getItem(${JSON.stringify(THEME_CACHE_KEY)})==="light"?"light":"dark";
d.setAttribute("data-theme",(flat&&th==="light")?"light":"dark");
var tt=localStorage.getItem(${JSON.stringify(SURFACE_TINT_CACHE_KEY)});
if(tt==="subtle"||tt==="vivid"||tt==="intense"){d.setAttribute("data-tint",tt);}
if(localStorage.getItem(${JSON.stringify(LAUNCH_INTRO_CACHE_KEY)})==="1"){d.setAttribute("data-launch-intro","true");}
var t=${JSON.stringify(
  Object.fromEntries(
    ACCENT_COLORS.map((c) => [c.id, { v: c.value, r: c.rgb, k: c.onAccent }]),
  ),
)};
var a=localStorage.getItem(${JSON.stringify(ACCENT_CACHE_KEY)});
var c=a&&t[a]?t[a]:t[${JSON.stringify(DEFAULT_ACCENT_COLOR)}];
if(c&&a&&a!==${JSON.stringify(DEFAULT_ACCENT_COLOR)}){
  var s=d.style;
  s.setProperty("--accent",c.v);
  s.setProperty("--mc-on-accent",c.k);
  s.setProperty("--accent-dim","rgba("+c.r+", 0.18)");
  s.setProperty("--accent-faint","rgba("+c.r+", 0.1)");
  s.setProperty("--accent-border","rgba("+c.r+", 0.38)");
  s.setProperty("--accent-glow","rgba("+c.r+", 0.48)");
  s.setProperty("--mc-btn-filled-image",'url("/borders/button_filled_'+a+'.png")');
  s.setProperty("--mc-panel-focused-image",'url("/borders/panel_focused_'+a+'.png")');
  s.setProperty("--mc-panel-image",'url("/borders/square_'+a+'.png")');
  s.setProperty("--mc-shell-image",'url("/borders/shell_'+a+'.png")');
}
}catch(e){}})();`;
const LAUNCH_AIRLOCK_AUDIO_MS = 1440;
const LAUNCH_WELCOME_AUDIO_OFFSET_SECONDS = 0.1;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MissionControl" },
    ],
  }),
  // Prime the bearer cache via IPC so the module-level token in src/lib/api.ts
  // is populated by the time child loaders start firing HTTP fetches. Note:
  // TanStack Router runs matched-route loaders in parallel by default, so
  // child loaders may race this prefetch — `resolveApiToken` (src/lib/api.ts)
  // dedupes via a lazy IPC fallback so the race resolves to the same token.
  // SSR rejects this (no Electron); the server entry registers a token resolver
  // for `resolveApiToken` without importing server-only modules into client code.
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData(apiTokenQueryOptions())
      .catch(() => null),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: PRE_HYDRATION_THEME_SCRIPT }}
        />
        <HeadContent />
      </head>
      <body>
        <LaunchIntroOverlayController />
        <KeybindingsProvider>
          <TerminalProvider>
            <UserTerminalProvider>
              <AddProjectProvider>
                <GroupsDialogProvider>
                <PromptSearchProvider>
                  <HeaderActionsProvider>
                    <DiagramDialogHost>
                      {/*
                       * The entire app shell reads client-only state — react-query
                       * data seeded synchronously from localStorage (installShellQueryCache)
                       * plus direct localStorage reads (theme, minimal mode).
                       * The server has none of that, so server HTML and the first
                       * client render disagree → hydration mismatch on every data-driven
                       * node (ProjectPicker, …). ClientOnly renders the
                       * fallback on the server AND the first client render so they match,
                       * then mounts the real shell after hydration. Past this boundary
                       * there's no SSR markup to match, so children are free to show
                       * skeletons/loading states however they like. `fallback` is the
                       * slot for an app-wide skeleton if we want one later.
                       */}
                      <ClientOnly fallback={null}>
                        <Shell />
                        {/* Sibling of Shell so the pet controller mounts once
                         * and survives Shell's focus-mode early return. */}
                        <Suspense fallback={null}>
                          <PetHost />
                        </Suspense>
                      </ClientOnly>
                    </DiagramDialogHost>
                  </HeaderActionsProvider>
                </PromptSearchProvider>
                </GroupsDialogProvider>
              </AddProjectProvider>
            </UserTerminalProvider>
          </TerminalProvider>
        </KeybindingsProvider>
        <Scripts />
      </body>
    </html>
  );
}

function LaunchIntroOverlayController() {
  const [active, setActive] = useState(false);
  const finish = useCallback(() => {
    setDocumentLaunchIntroActive(false);
    setActive(false);
  }, []);

  useThemeLayoutEffect(() => {
    if (!readCachedLaunchIntroEnabled()) {
      finish();
      return;
    }
    setDocumentLaunchIntroActive(true);
    setActive(true);
  }, [finish]);

  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(finish, LAUNCH_OVERLAY_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [active, finish]);

  return <LaunchOverlay active={active} onDone={finish} />;
}

// The active-session tail lives in its own leaf so the per-tick re-render from
// subscribing to the terminal data slice (`activeFor` returns a fresh session
// object whenever that session's task row updates) is confined here, instead of
// re-rendering the whole Shell + TopBar + ProjectBar. Props are all stable
// (actions + booleans) so it re-renders only on its own subscription.
const ProjectTerminalPanel = memo(function ProjectTerminalPanel({
  projectId,
  onClose,
  onHide,
  onPtyReady,
  expanded,
  onToggleExpanded,
}: {
  projectId: string;
  onClose: (taskId: string, opts?: { activateTaskId?: string | null }) => Promise<void>;
  onHide: (projectId: string) => void;
  onPtyReady: (taskId: string, ptyId: string | null, scopeKey?: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { activeFor } = useTerminals();
  return (
    <TerminalPanel
      active={activeFor(projectId)}
      onClose={onClose}
      onHide={() => onHide(projectId)}
      onPtyReady={onPtyReady}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
    />
  );
});

function Shell() {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<"usage" | null>(null);
  // Settings renders as a Shell-level overlay (see <SettingsPanel> below) rather
  // than a route, so the live app stays mounted behind it and the sliding panels
  // reveal the app instead of a black void. `settingsInitialPanel` is non-null
  // exactly when the overlay is open; its value seeds the panel's initial tab.
  const [settingsInitialPanel, setSettingsInitialPanel] =
    useState<SettingsPanelId | null>(null);
  const settingsOpen = settingsInitialPanel !== null;
  const openSettings = (initial: SettingsPanelId = "general") => {
    setSettingsInitialPanel((current) => current ?? initial);
  };
  const closeSettingsPanel = () => setSettingsInitialPanel(null);

  // Mirror the React open-state into the module flag that non-React global
  // keydown listeners (use-hotkey, the project route) read to suppress app
  // shortcuts while the modal-style overlay is open.
  useEffect(() => {
    setSettingsOverlayOpen(settingsOpen);
    return () => setSettingsOverlayOpen(false);
  }, [settingsOpen]);

  // Leaf components (e.g. ShipFailedDialog) dispatch OPEN_SETTINGS_EVENT to
  // request the Settings panel without prop-drilling through every parent.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ panel?: string }>).detail;
      const panel = detail?.panel;
      openSettings(SETTINGS_PANEL_IDS.includes(panel as SettingsPanelId)
        ? (panel as SettingsPanelId)
        : "general");
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
  }, [router]);
  useTheme();
  // Battery saver: drives the data-power-save root attribute from the
  // powerMonitor signal + setting (see src/lib/power-save.ts).
  usePowerSaveController();
  // Window idle: freezes decorative per-frame animations while the window is
  // blurred/hidden (see src/lib/window-idle.ts).
  useWindowIdleController();
  const { data: settings } = useSettings();
  const { data: projects } = useScopedProjects();
  const { activeGroup, groups } = useActiveGroup();
  // While the active sandbox's remote VM is resuming, the workspace isn't usable
  // yet: cover the route with a spinner and disable project navigation.
  const { data: sandboxState } = useSandboxes();
  const activeSandbox =
    sandboxState?.enabled
      ? sandboxState.sandboxes.find((s) => s.id === sandboxState.activeScopeId) ?? null
      : null;
  const activeResuming = activeSandbox?.remoteStatus === "resuming";
  // Pure actions (stable identity) + narrow flip-only subscriptions, so a
  // background session-status tick doesn't re-render the whole shell. The active
  // session itself lives in the ProjectTerminalPanel leaf below.
  const { close, deselect, setPtyId } = useTerminalActions();
  const gridView = useGridView();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const userTerminals = useUserTerminals();
  const {
    togglePanel,
    createTerminal,
    cyclePrev,
    cycleNext,
    panelOpen: userTerminalPanelOpen,
    focusedId: focusedUserTerminalId,
    killTerminal: killUserTerminal,
    sessions: userTerminalSessions,
  } = userTerminals;
  // Bootstrap from the same localStorage cache the pre-hydration script reads,
  // so the inset applies on first paint instead of waiting for settings to load.
  // Noir shares minimal's clean chrome, so any non-painted style counts.
  const cachedMinimal = readCachedThemeStyle() !== "painted";
  const effectiveMinimal = settings?.minimalTheme ?? cachedMinimal;
  // The top bar's leading inset applies in minimal mode.
  const topBarLeadingInset = effectiveMinimal ? 88 : undefined;
  const topBarContentTopInset = effectiveMinimal
    ? MINIMAL_TOP_BAR_CONTENT_TOP_INSET
    : 0;
  const windowDragLayerHeight = effectiveMinimal
    ? MINIMAL_WINDOW_DRAG_LAYER_HEIGHT
    : "var(--mc-shell-pad-top)";
  const [closeIntentTargetId, setCloseIntentTargetId] = useState<string | null>(null);
  const closeIntentTarget = closeIntentTargetId
    ? userTerminalSessions.find((s) => s.terminal.id === closeIntentTargetId)?.terminal ?? null
    : null;

  useNavigationSwipe();
  const sessionNotifications = useSessionFinishNotifications();
  const diagramNotificationList = useDiagramReadyNotificationList();
  const appNotifications = useMemo(
    () =>
      mergeAppNotificationLists(
        sessionNotifications.notifications,
        diagramNotificationList,
      ),
    [sessionNotifications.notifications, diagramNotificationList],
  );
  const clearAppNotificationItem = useCallback((notification: AppNotification) => {
    clearAppNotification(notification);
  }, []);
  const clearAllAppNotifications = useCallback(() => {
    clearAppNotifications();
  }, []);
  useWarmCliAvailability();

  const path = useRouterState({ select: (state) => state.location.pathname });
  const projectMatch = path.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch ? projectMatch[1]! : null;
  // Flip-only: true iff this project has a materialized active session. Gates
  // the expanded-terminal layout without subscribing to the churning data slice.
  const hasActiveSession = useHasActiveSession(projectId);
  // Focused Session Mode strips the whole shell: the /focus route renders the
  // only visible chrome, and the Electron window is a small floating card.
  const focusActive = isFocusPath(path);
  // The captured-screenshot stack is mounted here (not in the per-project route)
  // so it survives navigation between projects; the focus branch below returns
  // before it, so the focus window keeps its own scoped stack. macOS + Electron
  // only, mirroring the project route's gate.
  const screenshotsSupported = useMemo(() => screenshotSupported(), []);

  // Boot resync guard: if the main process says the window is still in focus
  // mode but we didn't land on a focus path (e.g. state drifted across a dev
  // restart), restore the window rather than leaving a shrunken full app.
  useEffect(() => {
    const electron = getElectron();
    if (!electron) return;
    void electron.focusMode
      .get()
      .then((state) => {
        if (state.active && !isFocusPath(window.location.pathname)) {
          void electron.focusMode.exit();
        }
      })
      .catch(() => undefined);
    // Once per app boot, not on navigation.
  }, []);

  const expandedKey = projectId ? `mc:terminalExpanded:${projectId}` : null;
  const [terminalExpanded, setTerminalExpanded] = useState<boolean>(false);
  useEffect(() => {
    if (!expandedKey) {
      setTerminalExpanded(false);
      return;
    }
    try {
      setTerminalExpanded(window.localStorage.getItem(expandedKey) === "1");
    } catch {
      setTerminalExpanded(false);
    }
  }, [expandedKey]);
  const toggleTerminalExpanded = useCallback(() => {
    if (!expandedKey) return;
    setTerminalExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(expandedKey, next ? "1" : "0");
      } catch {
        // ignore quota / privacy-mode errors
      }
      return next;
    });
  }, [expandedKey]);
  const sessionExpanded =
    !!projectId && terminalExpanded && hasActiveSession;
  // Grid view takes over the whole workspace: the Outlet (which renders the
  // grid below the project header) spans full width and the single right-hand
  // terminal panel is hidden.
  const gridActive = !!projectMatch && gridView;
  const crumbs: Crumb[] = settingsOpen
    ? [{ label: "Settings" }]
    : projectMatch
    ? [{ label: "Project", node: <ProjectPicker projectId={projectMatch[1]} disabled={activeResuming} /> }]
      : activePanel === "usage"
        ? [{ label: "Usage" }]
      : [{ label: "Project", node: <ProjectPicker disabled={activeResuming} /> }];

  const closePanel = () => setActivePanel(null);

  const goHome = () => {
    setActivePanel(null);
    if (settingsOpen) requestCloseSettings();
    router.navigate({ to: "/" });
  };

  useEffect(() => {
    applyAccentColor(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
  }, [settings?.accentColor]);

  // Appearance settings land as inline CSS vars on <html>; live terminals
  // pick them up through watchTerminalColorScheme's style observer.
  const terminalFontFamily = settings?.terminalFontFamily ?? null;
  const terminalFontWeight =
    settings?.terminalFontWeight ?? DEFAULT_TERMINAL_FONT_WEIGHT;
  const terminalFontWeightBold =
    settings?.terminalFontWeightBold ?? DEFAULT_TERMINAL_FONT_WEIGHT_BOLD;
  const terminalLineHeight =
    settings?.terminalLineHeight ?? DEFAULT_TERMINAL_LINE_HEIGHT;
  const terminalLetterSpacing =
    settings?.terminalLetterSpacing ?? DEFAULT_TERMINAL_LETTER_SPACING;
  useEffect(() => {
    if (!settings) return;
    applyTerminalAppearance({
      fontFamily: terminalFontFamily,
      fontWeight: terminalFontWeight,
      fontWeightBold: terminalFontWeightBold,
      lineHeight: terminalLineHeight,
      letterSpacing: terminalLetterSpacing,
    });
  }, [
    settings,
    terminalFontFamily,
    terminalFontWeight,
    terminalFontWeightBold,
    terminalLineHeight,
    terminalLetterSpacing,
  ]);

  const interfaceFontFamily = settings?.interfaceFontFamily ?? null;
  useEffect(() => {
    if (!settings) return;
    applyInterfaceFontFamily(interfaceFontFamily);
  }, [settings, interfaceFontFamily]);

  const interfaceFontScale = settings?.interfaceFontScale;
  useEffect(() => {
    if (interfaceFontScale === undefined) return;
    applyInterfaceFontScale(interfaceFontScale);
  }, [interfaceFontScale]);

  const launchOverlayEnabled = settings?.launchOverlayEnabled;
  const themeStyle = settings?.themeStyle;

  useThemeLayoutEffect(() => {
    if (typeof launchOverlayEnabled !== "boolean") return;
    if (launchOverlayEnabled || !hasCachedLaunchIntroPreference()) {
      writeCachedLaunchIntroEnabled(launchOverlayEnabled);
    }
  }, [launchOverlayEnabled]);

  useThemeLayoutEffect(() => {
    if (!themeStyle) return;
    applyThemeStyle(themeStyle);
  }, [themeStyle]);

  const surfaceTint = settings?.surfaceTint;

  useThemeLayoutEffect(() => {
    if (!surfaceTint) return;
    applySurfaceTint(surfaceTint);
  }, [surfaceTint]);

  // Recompute + re-observe the workspace bounds whenever the workspace div is
  // (un)mounted. Focus mode early-returns above and tears down the whole #root
  // subtree, so on entry `workspaceRef.current` is null and on exit it's a brand
  // new node. Keying this on `focusActive` re-runs the effect across those
  // transitions: the cleanup disconnects the stale observer/listener (which
  // otherwise keep measuring the detached old node and collapse overlays sized
  // off --mc-workspace-* to 0×0), and the re-run re-binds to the live div.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const updateWorkspaceBounds = () => {
      const rect = workspace.getBoundingClientRect();
      document.documentElement.style.setProperty("--mc-workspace-top", `${rect.top}px`);
      document.documentElement.style.setProperty("--mc-workspace-left", `${rect.left}px`);
      document.documentElement.style.setProperty(
        "--mc-workspace-right",
        `${window.innerWidth - rect.right}px`,
      );
      document.documentElement.style.setProperty(
        "--mc-workspace-bottom",
        `${window.innerHeight - rect.bottom}px`,
      );
    };

    updateWorkspaceBounds();
    const observer = new ResizeObserver(updateWorkspaceBounds);
    observer.observe(workspace);
    window.addEventListener("resize", updateWorkspaceBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWorkspaceBounds);
      document.documentElement.style.removeProperty("--mc-workspace-top");
      document.documentElement.style.removeProperty("--mc-workspace-left");
      document.documentElement.style.removeProperty("--mc-workspace-right");
      document.documentElement.style.removeProperty("--mc-workspace-bottom");
    };
  }, [focusActive]);

  useHotkey("terminal.toggle", () => togglePanel());
  useHotkey(
    "terminal.expandToggle",
    () => {
      if (userTerminalPanelOpen && isUserTerminalXtermFocused()) {
        window.dispatchEvent(new Event(CLEAR_USER_TERMINAL_EVENT));
        return;
      }
      // While the grid owns the workspace there's no single-session panel; hand
      // the shortcut to SessionGrid so it expands/collapses the focused cell.
      if (gridActive) {
        window.dispatchEvent(new Event(GRID_EXPAND_TOGGLE_EVENT));
        return;
      }
      if (projectId && hasActiveSession) toggleTerminalExpanded();
    },
    { capture: true },
  );
  useHotkey("nav.toggle", goHome);
  // Cmd/Ctrl + =/-/0 zoom or reset the focused terminal; otherwise leave browser
  // zoom alone.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const intent = terminalZoomIntentFromKeyboard(e);
      if (intent === null) return;
      if (!isTerminalXtermFocused()) return;
      e.preventDefault();
      e.stopPropagation();
      const event =
        intent === "in"
          ? TERMINAL_ZOOM_IN_EVENT
          : intent === "out"
            ? TERMINAL_ZOOM_OUT_EVENT
            : TERMINAL_ZOOM_RESET_EVENT;
      window.dispatchEvent(new Event(event));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  // Cmd/Ctrl + [ / ] / T are non-rebindable terminal-focused shortcuts.
  // Capture phase: a focused xterm textarea swallows these on bubble.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if ((e.key === "t" || e.key === "T") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        void createTerminal();
        return;
      }
      if (e.key === "[" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        cyclePrev();
        return;
      }
      if (e.key === "]" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        cycleNext();
        return;
      }
      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        // Pinned-project nav is disabled while the active sandbox resumes.
        if (activeResuming) return;
        // Same computed list as the rail renders — slot badges and hotkeys
        // must agree, including in group-workspace mode.
        const railProjects = getRailProjects(projects ?? [], groups, activeGroup);
        const idx = Number(e.key) - 1;
        const target = railProjects[idx];
        if (target) {
          e.preventDefault();
          e.stopPropagation();
          router.navigate({ to: "/projects/$id", params: { id: target.id } });
        }
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeGroup, activeResuming, createTerminal, cycleNext, cyclePrev, groups, projects, router]);

  // Cmd/Ctrl+W is intercepted in the Electron main process (otherwise the
  // default app menu's "Close Window" item closes the BrowserWindow before any
  // renderer handler runs). The main process forwards an `app:close-intent`
  // event; we close the focused user terminal if the panel is open.
  useEffect(() => {
    const electron = getElectron();
    if (!electron) return;
    return electron.onCloseIntent(() => {
      if (userTerminalPanelOpen && focusedUserTerminalId && isUserTerminalXtermFocused()) {
        setCloseIntentTargetId(focusedUserTerminalId);
      }
    });
  }, [userTerminalPanelOpen, focusedUserTerminalId]);

  if (focusActive) {
    // Only the focus route renders: no #root (skips the shell padding /
    // painted frame), no TopBar/ProjectBar/panels/drag-strip. All Shell hooks
    // above keep running so notifications for other sessions stay alive.
    // `data-navigation-swipe-blocker` opts the whole focus window out of the
    // global back/forward swipe (useNavigationSwipe): a two-finger horizontal
    // swipe here scrolls the session bar's tabs, it must never navigate away.
    return (
      <div
        data-navigation-swipe-blocker
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <Outlet />
        <SessionFileDropZone />
      </div>
    );
  }

  return (
    <>
      {screenshotsSupported && <ScreenshotThumbnail projectId={projectId} />}
      <div id="root">
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: windowDragLayerHeight,
            zIndex: WINDOW_DRAG_LAYER_Z_INDEX,
            ["WebkitAppRegion" as any]: "drag",
          }}
        />
        {/* Banner hidden for now — toggle also removed from Settings. */}
        <TopBar
          crumbs={crumbs}
          onHome={goHome}
          centerActions={
            <>
              {/* Project cockpit, one grouped band: context (which project /
               * which scope) then the project actions (run, branch/changes/
               * ship, worktree, grid) portalled in by the project route. The
               * sandbox switcher sits with the project as context; the single
               * context→actions divider is the project route's leading action
               * so it only appears when there are actions to separate. */}
              <ScopeDropdown />
              <GroupSwitcher />
              <HeaderActionsSlot />
            </>
          }
          leadingInset={topBarLeadingInset}
          contentTopInset={topBarContentTopInset}
          // Keep the header draggable in every theme. In minimal mode #root
          // has no top padding and the fixed drag strip is only 8px tall, so
          // disabling drag here left the window with essentially no grab
          // surface. Interactive children already opt out via `no-drag`.
          dragRegion
          right={
            <>
              <UpdateAvailableButton />
              <ProviderUsageIndicator />
              <HeaderBeforeSearchSlot />
              <PromptSearchButton />
              <VoicePushToTalkButton />
              <SessionNotificationsButton
                notifications={appNotifications}
                onClearNotification={clearAppNotificationItem}
                onClearNotifications={clearAllAppNotifications}
              />
              <Btn
                variant="ghost"
                icon="settings"
                onClick={() =>
                  settingsOpen ? requestCloseSettings() : openSettings()
                }
                aria-label={settingsOpen ? "Close settings" : "Open settings"}
                title={settingsOpen ? "Close settings" : "Open settings"}
              />
            </>
          }
        />
        <div
          ref={workspaceRef}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
            <ProjectBar disabled={activeResuming} />
            <div
              style={{
                position: "relative",
                flex: 1,
                // Grid view lives inside the Outlet, so the expanded-terminal
                // flag must never hide it — both can be true at once (the
                // expand flag persists per project, the grid flag globally).
                display: sessionExpanded && !gridActive ? "none" : "flex",
                flexDirection: "column",
                overflow: "hidden",
                // On the project detail view the terminal panel sits to the
                // right; floor the left panel so dragging the terminal wider
                // shrinks the terminal instead of wrapping the session columns.
                // In grid view the panel is hidden, so let the Outlet go full width.
                minWidth: projectMatch && !gridActive ? 640 : 0,
                minHeight: 0,
              }}
            >
              <Outlet />
              {activeResuming && activeSandbox && <SandboxResumingOverlay name={activeSandbox.name} />}
            </div>
            {projectMatch && !gridActive && (
              <ProjectTerminalPanel
                projectId={projectMatch[1]!}
                onClose={close}
                onHide={deselect}
                onPtyReady={setPtyId}
                expanded={sessionExpanded}
                onToggleExpanded={toggleTerminalExpanded}
              />
            )}
          </div>
          <UserTerminalPanel />
        </div>
        {activePanel === "usage" && <UsagePanel onBack={closePanel} />}
        {settingsOpen && (
          <Suspense fallback={null}>
            <SettingsPanel
              initialPanel={settingsInitialPanel ?? "general"}
              onBack={closeSettingsPanel}
            />
          </Suspense>
        )}
        <Toaster
          position="bottom-right"
          theme="dark"
          closeButton
          // Toasts stack above the Mission Pet when it shares the bottom-right
          // corner; left-home pets leave that corner free for the default offset.
          offset={
            (settings?.petEnabled ?? true) &&
            (settings?.petHomeSide ?? DEFAULT_PET_HOME_SIDE) === "right"
              ? { bottom: 132, right: 16 }
              : 16
          }
          style={{ zIndex: Z_INDEX.toast }}
          icons={{ close: MC_TOAST_CLOSE_ICON }}
          toastOptions={{
            unstyled: true,
            closeButton: true,
            closeButtonAriaLabel: "Close",
            classNames: MC_TOAST_CLASS_NAMES,
          }}
        />
        <VoiceController />
        {/* PetWidget + RemotePets render via the lazy PetHost (Shell sibling). */}
        <SessionFileDropZone />
      </div>
      <ConfirmDialog
        open={!!closeIntentTarget}
        onClose={() => setCloseIntentTargetId(null)}
        onConfirm={() => {
          const id = closeIntentTargetId;
          setCloseIntentTargetId(null);
          if (id) void killUserTerminal(id);
        }}
        title={
          closeIntentTarget
            ? `Delete terminal "${closeIntentTarget.name}"?`
            : "Delete terminal?"
        }
        confirmLabel="Delete"
        variant="danger"
        icon="trash"
      >
        This will kill the running process and remove the terminal. This can&apos;t be undone.
      </ConfirmDialog>
      <ThemeOnboardingGate />
    </>
  );
}

function LaunchOverlay({
  active,
  onDone,
}: {
  active: boolean;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!active) return;
    const audioElements: HTMLAudioElement[] = [];
    const playAudio = (src: string, volume: number, startAtSeconds = 0) => {
      const audio = new Audio(src);
      audioElements.push(audio);
      audio.preload = "auto";
      audio.volume = volume;
      if (startAtSeconds > 0) {
        audio.currentTime = startAtSeconds;
      }
      void audio.play().catch(() => {
        // Browsers may block startup audio until the first user gesture.
      });
    };

    playAudio("/audio/welcome.mp3", 0.2, LAUNCH_WELCOME_AUDIO_OFFSET_SECONDS);

    const slideTimeout = window.setTimeout(
      () => playAudio("/audio/slide.ogg", 0.2),
      LAUNCH_AIRLOCK_AUDIO_MS,
    );

    return () => {
      window.clearTimeout(slideTimeout);
      for (const audio of audioElements) {
        audio.pause();
      }
    };
  }, [active]);

  return (
    <div
      className="launch-overlay"
      data-active={active ? "true" : undefined}
      role="status"
      aria-label="Mission Control loading"
      onAnimationEnd={(event) => {
        if (event.currentTarget === event.target) onDone();
      }}
    >
      <div className="launch-overlay__doors" aria-hidden="true">
        <div className="launch-overlay__door launch-overlay__door--left">
          <img src="/images/doors.png" alt="" />
        </div>
        <div className="launch-overlay__door launch-overlay__door--right">
          <img src="/images/doors.png" alt="" />
        </div>
      </div>
      <div className="launch-overlay__fog" aria-hidden="true">
        <span className="launch-overlay__fog-plume launch-overlay__fog-plume--top launch-overlay__fog-plume--left" />
        <span className="launch-overlay__fog-plume launch-overlay__fog-plume--top launch-overlay__fog-plume--right" />
        <span className="launch-overlay__fog-plume launch-overlay__fog-plume--bottom launch-overlay__fog-plume--left" />
        <span className="launch-overlay__fog-plume launch-overlay__fog-plume--bottom launch-overlay__fog-plume--right" />
        <span className="launch-overlay__fog-floor launch-overlay__fog-floor--top" />
        <span className="launch-overlay__fog-floor launch-overlay__fog-floor--bottom" />
      </div>
    </div>
  );
}
