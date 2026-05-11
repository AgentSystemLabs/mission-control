import { useCallback, useEffect, useRef, useState } from "react";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { getElectron } from "~/lib/electron";
import { TopBar, type Crumb } from "~/components/ui/TopBar";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
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
import { useSettings, useProjects, useLicense } from "~/queries";
import { LicenseBadge } from "~/components/views/LicenseBadge";
import { UpdateAvailableButton } from "~/components/ui/UpdateAvailableButton";
import { applyAccentColor, DEFAULT_ACCENT_COLOR } from "~/lib/accent-colors";
import { SettingsPanel, type SettingsPanelId } from "~/components/views/SettingsPanel";
import { UsagePanel } from "~/components/views/UsagePanel";
import { Toaster } from "sonner";
import { useSessionFinishNotifications } from "~/lib/use-session-finish-notifications";
import "~/styles.css";

const LAUNCH_OVERLAY_DURATION_MS = 2700;
const LAUNCH_DOORS_OPEN_MS = 1940;
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
  component: RootComponent,
});

function RootComponent() {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        <KeybindingsProvider>
          <TerminalProvider>
            <UserTerminalProvider>
              <AddProjectProvider>
                <Shell />
              </AddProjectProvider>
            </UserTerminalProvider>
          </TerminalProvider>
        </KeybindingsProvider>
        <Scripts />
      </body>
    </html>
  );
}

function Shell() {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<"settings" | "usage" | null>(null);
  const [showLaunchOverlay, setShowLaunchOverlay] = useState(true);
  const [settingsInitialPanel, setSettingsInitialPanel] =
    useState<SettingsPanelId>("general");
  const openSettings = (initial: SettingsPanelId = "general") => {
    setSettingsInitialPanel(initial);
    setActivePanel("settings");
  };
  useTheme();
  const { data: settings } = useSettings();
  const { data: projects } = useProjects();
  const { data: license } = useLicense();
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
  } = userTerminals;

  useNavigationSwipe();
  useSessionFinishNotifications();

  const path = router.state.location.pathname;
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
    ? [{ label: "Project", node: <ProjectPicker projectId={projectMatch[1]} /> }]
    : activePanel === "settings"
      ? [{ label: "Settings" }]
      : activePanel === "usage"
        ? [{ label: "Usage" }]
      : [{ label: "Project", node: <ProjectPicker /> }];

  const closePanel = () => setActivePanel(null);

  const goHome = () => {
    setActivePanel(null);
    router.navigate({ to: "/" });
  };

  useEffect(() => {
    applyAccentColor(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
  }, [settings?.accentColor]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setShowLaunchOverlay(false),
      LAUNCH_OVERLAY_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, []);

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
      if (projectId && activeFor(projectId)) toggleTerminalExpanded();
    },
    { capture: true },
  );
  useHotkey("nav.toggle", goHome);
  // Cmd/Ctrl + [ / ] / T are non-rebindable terminal-focused shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if ((e.key === "t" || e.key === "T") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void createTerminal();
        return;
      }
      if (e.key === "[" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        cyclePrev();
        return;
      }
      if (e.key === "]" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        cycleNext();
        return;
      }
      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const pinned = (projects ?? []).filter((p) => p.pinned);
        const idx = Number(e.key) - 1;
        const target = pinned[idx];
        if (target) {
          e.preventDefault();
          router.navigate({ to: "/projects/$id", params: { id: target.id } });
        }
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createTerminal, cycleNext, cyclePrev, projects, router]);

  // Cmd/Ctrl+W is intercepted in the Electron main process (otherwise the
  // default app menu's "Close Window" item closes the BrowserWindow before any
  // renderer handler runs). The main process forwards an `app:close-intent`
  // event; we close the focused user terminal if the panel is open.
  useEffect(() => {
    const electron = getElectron();
    if (!electron) return;
    return electron.onCloseIntent(() => {
      if (userTerminalPanelOpen && focusedUserTerminalId) {
        void killUserTerminal(focusedUserTerminalId);
      }
    });
  }, [userTerminalPanelOpen, focusedUserTerminalId, killUserTerminal]);

  return (
    <>
      <div id="root">
        <AgentSystemBanner onOpenSettings={() => setActivePanel("settings")} />
        <TopBar
          crumbs={crumbs}
          onHome={goHome}
          leading={<LicenseBadge />}
          right={
            <>
              <UpdateAvailableButton />
              <Btn
                variant="ghost"
                icon="settings"
                onClick={() =>
                  setActivePanel(activePanel === "settings" ? null : "settings")
                }
                aria-label={activePanel === "settings" ? "Close settings" : "Open settings"}
                title={activePanel === "settings" ? "Close settings" : "Open settings"}
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
            <ProjectBar />
            <div
              style={{
                flex: 1,
                display: sessionExpanded ? "none" : "flex",
                flexDirection: "column",
                overflow: "hidden",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <Outlet />
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
        {activePanel === "settings" && (
          <SettingsPanel onBack={closePanel} initialPanel={settingsInitialPanel} />
        )}
        {activePanel === "usage" && <UsagePanel onBack={closePanel} />}
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            unstyled: true,
            style: { background: "transparent", border: "none", padding: 0, boxShadow: "none" },
          }}
        />
      </div>
      {showLaunchOverlay && (
        <LaunchOverlay audioDisabled={settings?.launchAudioDisabled} />
      )}
    </>
  );
}

function LaunchOverlay({ audioDisabled }: { audioDisabled: boolean | undefined }) {
  useEffect(() => {
    if (audioDisabled !== false) return;
    const playAudio = (src: string, startAtSeconds = 0) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      if (startAtSeconds > 0) {
        audio.currentTime = startAtSeconds;
      }
      void audio.play().catch(() => {
        // Browsers may block startup audio until the first user gesture.
      });
    };

    playAudio("/audio/welcome.mp3", LAUNCH_WELCOME_AUDIO_OFFSET_SECONDS);

    const slideTimeout = window.setTimeout(
      () => playAudio("/audio/slide.ogg"),
      LAUNCH_AIRLOCK_AUDIO_MS,
    );

    return () => {
      window.clearTimeout(slideTimeout);
    };
  }, [audioDisabled]);

  return (
    <div className="launch-overlay" role="status" aria-label="Mission Control loading">
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

function AgentSystemBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const { data: settings } = useSettings();

  useEffect(() => {
    if (settings?.agentSystemBannerDisabled) setDismissed(false);
  }, [settings?.agentSystemBannerDisabled]);

  if (settings?.agentSystemBannerDisabled || dismissed) return null;

  return (
    <div
      role="region"
      aria-label="AgentSystem.dev promotion"
      style={{
        minHeight: 42,
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        flexWrap: "wrap",
        background: "transparent",
        borderBottom: "1px solid var(--border-strong)",
        color: "var(--text)",
        flexShrink: 0,
        position: "relative",
        zIndex: 11,
        userSelect: "none",
        ["WebkitAppRegion" as any]: "drag",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: 6,
          background: "var(--banner-icon-bg)",
          color: "var(--banner-link)",
          border: "1px solid var(--accent-border)",
          flexShrink: 0,
        }}
      >
        <Icon name="sparkles" size={14} />
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.35,
          color: "var(--banner-muted)",
          textAlign: "center",
        }}
      >
        <strong style={{ color: "var(--text)", fontWeight: 600 }}>Level up your agentic coding game.</strong>{" "}
        Get the powerful skill pack and complete walkthrough at{" "}
        <a
          href="https://agentsystem.dev"
          target="_blank"
          rel="noreferrer"
          style={{
            color: "var(--banner-link)",
            fontWeight: 600,
            textDecoration: "none",
            ["WebkitAppRegion" as any]: "no-drag",
          }}
        >
          AgentSystem.dev
        </a>
        .
        <button
          type="button"
          onClick={onOpenSettings}
          style={{
            marginLeft: 8,
            color: "var(--banner-muted)",
            fontSize: 11.5,
            fontWeight: 500,
            textDecoration: "underline",
            textUnderlineOffset: 3,
            border: 0,
            padding: 0,
            background: "transparent",
            cursor: "pointer",
            ["WebkitAppRegion" as any]: "no-drag",
          }}
        >
          Disable banner in settings
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss AgentSystem.dev banner"
        onClick={() => setDismissed(true)}
        style={{
          width: 28,
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface-1)",
          color: "var(--banner-muted)",
          cursor: "pointer",
          flexShrink: 0,
          ["WebkitAppRegion" as any]: "no-drag",
        }}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
