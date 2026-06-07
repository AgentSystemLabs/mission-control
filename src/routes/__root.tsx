import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { getPinnedProjects } from "~/lib/pinned-project-order";
import { getElectron } from "~/lib/electron";
import { TopBar, type Crumb } from "~/components/ui/TopBar";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
import { KeybindingsProvider } from "~/lib/keybindings/store";
import { useNavigationSwipe } from "~/lib/use-navigation-swipe";
import { useTheme } from "~/lib/use-theme";
import { TerminalProvider, useTerminals } from "~/lib/terminal-store";
import {
  UserTerminalProvider,
  useUserTerminals,
} from "~/lib/user-terminal-store";
import { TerminalPanel } from "~/components/views/TerminalPanel";
import { UserTerminalPanel } from "~/components/views/UserTerminalPanel";
import { ProjectPicker } from "~/components/views/ProjectPicker";
import { ProjectBar } from "~/components/views/ProjectBar";
import { AddProjectProvider } from "~/lib/add-project-store";
import { HeaderActionsProvider, HeaderActionsSlot } from "~/components/ui/HeaderActionsSlot";
import { apiTokenQueryOptions, useSettings, useScopedProjects, useSandboxes } from "~/queries";
import { SandboxResumingOverlay } from "~/components/views/SandboxResumingOverlay";
import { LicenseBadge } from "~/components/views/LicenseBadge";
import { ScopeDropdown } from "~/components/views/ScopeDropdown";
import { UpdateAvailableButton } from "~/components/ui/UpdateAvailableButton";
import {
  ACCENT_CACHE_KEY,
  ACCENT_COLORS,
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
} from "~/lib/accent-colors";
import { SETTINGS_PANEL_IDS, type SettingsPanelId } from "~/components/views/SettingsPanel";
import { OPEN_SETTINGS_EVENT } from "~/lib/design-meta";
import {
  openSettingsRoute,
  toggleSettingsRoute,
} from "~/lib/settings-navigation";

import { UsagePanel } from "~/components/views/UsagePanel";
import { SessionNotificationsButton } from "~/components/views/SessionNotificationsButton";
import { Toaster } from "sonner";
import { MC_TOAST_CLASS_NAMES, MC_TOAST_CLOSE_ICON } from "~/lib/mc-toast";
import { useSessionFinishNotifications } from "~/lib/use-session-finish-notifications";
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
import { isUserTerminalXtermFocused, isTerminalXtermFocused, terminalZoomStepFromKeyboard } from "~/lib/terminal-pane-helpers";
import { useWarmCliAvailability } from "~/lib/cli-availability";
import {
  CLEAR_USER_TERMINAL_EVENT,
  TERMINAL_ZOOM_IN_EVENT,
  TERMINAL_ZOOM_OUT_EVENT,
} from "~/lib/design-meta";
import {
  LAUNCH_INTRO_CACHE_KEY,
  hasCachedLaunchIntroPreference,
  readCachedLaunchIntroEnabled,
  setDocumentLaunchIntroActive,
  writeCachedLaunchIntroEnabled,
} from "~/lib/launch-intro";
import {
  writeCachedWorktreesEnabled,
} from "~/lib/worktrees-preference";
import "~/styles.css";

const LAUNCH_OVERLAY_DURATION_MS = 2700;
const MINIMAL_CACHE_KEY = "mc:minimal";
const useThemeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Pre-hydration script: runs synchronously in <head> before first paint so
// theme state (`data-minimal` + accent CSS vars) is in place before any CSS
// layout. Without this, the SSR'd HTML paints with default (painted+orange)
// theme for one frame — every accent-tinted surface flashes orange before
// React/useSettings hydrate. Mirrors `applyAccentColor`
// (src/lib/accent-colors.ts); keep them in sync.
const PRE_HYDRATION_THEME_SCRIPT = `(function(){try{
var d=document.documentElement;
if(localStorage.getItem(${JSON.stringify(MINIMAL_CACHE_KEY)})==="1"){d.setAttribute("data-minimal","true");}
if(localStorage.getItem(${JSON.stringify(LAUNCH_INTRO_CACHE_KEY)})==="1"){d.setAttribute("data-launch-intro","true");}
var t=${JSON.stringify(
  Object.fromEntries(ACCENT_COLORS.map((c) => [c.id, { v: c.value, r: c.rgb }])),
)};
var a=localStorage.getItem(${JSON.stringify(ACCENT_CACHE_KEY)});
var c=a&&t[a]?t[a]:t[${JSON.stringify(DEFAULT_ACCENT_COLOR)}];
if(c&&a&&a!==${JSON.stringify(DEFAULT_ACCENT_COLOR)}){
  var s=d.style;
  s.setProperty("--accent",c.v);
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
          // eslint-disable-next-line react/no-danger
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
                <HeaderActionsProvider>
                  <DiagramDialogHost>
                    <Shell />
                  </DiagramDialogHost>
                </HeaderActionsProvider>
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

function Shell() {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<"usage" | null>(null);
  const openSettings = (initial: SettingsPanelId = "general") => {
    openSettingsRoute(router, initial);
  };

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
  const { data: settings } = useSettings();
  const { data: projects } = useScopedProjects();
  // While the active sandbox's remote VM is resuming, the workspace isn't usable
  // yet: cover the route with a spinner and disable project navigation.
  const { data: sandboxState } = useSandboxes();
  const activeSandbox =
    sandboxState?.enabled
      ? sandboxState.sandboxes.find((s) => s.id === sandboxState.activeScopeId) ?? null
      : null;
  const activeResuming = activeSandbox?.remoteStatus === "resuming";
  const { activeFor, close, deselect, setPtyId } = useTerminals();
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
  const cachedMinimal =
    typeof window !== "undefined" &&
    (() => {
      try {
        return window.localStorage.getItem(MINIMAL_CACHE_KEY) === "1";
      } catch {
        return false;
      }
    })();
  const effectiveMinimal = settings?.minimalTheme ?? cachedMinimal;
  // The top bar's leading inset applies in minimal mode.
  const topBarLeadingInset = effectiveMinimal ? 130 : undefined;
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
    !!projectId && terminalExpanded && !!activeFor(projectId);
  const crumbs: Crumb[] = projectMatch
    ? [{ label: "Project", node: <ProjectPicker projectId={projectMatch[1]} disabled={activeResuming} /> }]
    : path === "/settings"
      ? [{ label: "Settings" }]
      : activePanel === "usage"
        ? [{ label: "Usage" }]
      : [{ label: "Project", node: <ProjectPicker disabled={activeResuming} /> }];

  const closePanel = () => setActivePanel(null);

  const goHome = () => {
    setActivePanel(null);
    router.navigate({ to: "/" });
  };

  useEffect(() => {
    applyAccentColor(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
  }, [settings?.accentColor]);

  const launchOverlayEnabled = settings?.launchOverlayEnabled;
  const minimalTheme = settings?.minimalTheme;

  useThemeLayoutEffect(() => {
    if (typeof launchOverlayEnabled !== "boolean") return;
    if (launchOverlayEnabled || !hasCachedLaunchIntroPreference()) {
      writeCachedLaunchIntroEnabled(launchOverlayEnabled);
    }
  }, [launchOverlayEnabled]);

  useThemeLayoutEffect(() => {
    if (typeof settings?.worktreesEnabled !== "boolean") return;
    writeCachedWorktreesEnabled(settings.worktreesEnabled);
  }, [settings?.worktreesEnabled]);

  useThemeLayoutEffect(() => {
    if (typeof minimalTheme !== "boolean") return;
    try {
      window.localStorage.setItem(MINIMAL_CACHE_KEY, minimalTheme ? "1" : "0");
    } catch {
      // ignore quota / privacy-mode errors
    }
    if (minimalTheme) {
      document.documentElement.setAttribute("data-minimal", "true");
    } else {
      document.documentElement.removeAttribute("data-minimal");
    }
  }, [minimalTheme]);

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
  }, []);

  useHotkey("terminal.toggle", () => togglePanel());
  useHotkey(
    "terminal.expandToggle",
    () => {
      if (userTerminalPanelOpen && isUserTerminalXtermFocused()) {
        window.dispatchEvent(new Event(CLEAR_USER_TERMINAL_EVENT));
        return;
      }
      if (projectId && activeFor(projectId)) toggleTerminalExpanded();
    },
    { capture: true },
  );
  useHotkey("nav.toggle", goHome);
  // Cmd/Ctrl + =/- zoom the focused terminal; otherwise leave browser zoom alone.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const direction = terminalZoomStepFromKeyboard(e);
      if (direction === null) return;
      if (!isTerminalXtermFocused()) return;
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new Event(direction === 1 ? TERMINAL_ZOOM_IN_EVENT : TERMINAL_ZOOM_OUT_EVENT),
      );
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
        const pinned = getPinnedProjects(projects ?? []);
        const idx = Number(e.key) - 1;
        const target = pinned[idx];
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
  }, [activeResuming, createTerminal, cycleNext, cyclePrev, projects, router]);

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

  return (
    <>
      <div id="root">
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: 40,
            zIndex: 1,
            ["WebkitAppRegion" as any]: "drag",
          }}
        />
        {/* Banner hidden for now — toggle also removed from Settings. */}
        <TopBar
          crumbs={crumbs}
          onHome={goHome}
          leading={<LicenseBadge />}
          centerActions={
            <>
              {/* Sandbox switcher sits to the right of the selected project. */}
              <ScopeDropdown />
              <HeaderActionsSlot />
            </>
          }
          leadingInset={topBarLeadingInset}
          right={
            <>
              <UpdateAvailableButton />
              <SessionNotificationsButton
                notifications={appNotifications}
                onClearNotification={clearAppNotificationItem}
                onClearNotifications={clearAllAppNotifications}
              />
              <Btn
                variant="ghost"
                icon="settings"
                onClick={() => toggleSettingsRoute(router)}
                aria-label={path === "/settings" ? "Close settings" : "Open settings"}
                title={path === "/settings" ? "Close settings" : "Open settings"}
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
                display: sessionExpanded ? "none" : "flex",
                flexDirection: "column",
                overflow: "hidden",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <Outlet />
              {activeResuming && activeSandbox && <SandboxResumingOverlay name={activeSandbox.name} />}
            </div>
            {projectMatch && (
              <TerminalPanel
                active={activeFor(projectMatch[1]!)}
                onClose={close}
                onHide={() => deselect(projectMatch[1]!)}
                onPtyReady={setPtyId}
                expanded={sessionExpanded}
                onToggleExpanded={toggleTerminalExpanded}
              />
            )}
          </div>
          <UserTerminalPanel />
        </div>
        {activePanel === "usage" && <UsagePanel onBack={closePanel} />}
        <Toaster
          position="bottom-right"
          theme="dark"
          closeButton
          offset={16}
          icons={{ close: MC_TOAST_CLOSE_ICON }}
          toastOptions={{
            unstyled: true,
            closeButton: true,
            closeButtonAriaLabel: "Close",
            classNames: MC_TOAST_CLASS_NAMES,
          }}
        />
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
