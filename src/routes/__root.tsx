import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
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
import { HeaderActionsProvider, HeaderActionsSlot } from "~/components/ui/HeaderActionsSlot";
import { apiTokenQueryOptions, useSettings, useProjects, useLicense } from "~/queries";
import { LicenseBadge } from "~/components/views/LicenseBadge";
import { UpdateAvailableButton } from "~/components/ui/UpdateAvailableButton";
import {
  ACCENT_CACHE_KEY,
  ACCENT_COLORS,
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
} from "~/lib/accent-colors";
import { SettingsPanel, type SettingsPanelId } from "~/components/views/SettingsPanel";
import { UsagePanel } from "~/components/views/UsagePanel";
import { Toaster } from "sonner";
import { useSessionFinishNotifications } from "~/lib/use-session-finish-notifications";
import { useWarmCliAvailability } from "~/lib/cli-availability";
import "~/styles.css";

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
    <html>
      <head>
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: PRE_HYDRATION_THEME_SCRIPT }}
        />
        <HeadContent />
      </head>
      <body>
        <KeybindingsProvider>
          <TerminalProvider>
            <UserTerminalProvider>
              <AddProjectProvider>
                <HeaderActionsProvider>
                  <Shell />
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

function Shell() {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<"settings" | "usage" | null>(null);
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
    sessions: userTerminalSessions,
  } = userTerminals;
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    if (settings?.agentSystemBannerDisabled) setBannerDismissed(false);
  }, [settings?.agentSystemBannerDisabled]);
  const bannerHidden =
    !!settings?.agentSystemBannerDisabled || bannerDismissed;
  const topBarLeadingInset =
    settings?.minimalTheme && bannerHidden ? 130 : undefined;
  const [closeIntentTargetId, setCloseIntentTargetId] = useState<string | null>(null);
  const closeIntentTarget = closeIntentTargetId
    ? userTerminalSessions.find((s) => s.terminal.id === closeIntentTargetId)?.terminal ?? null
    : null;

  useNavigationSwipe();
  useSessionFinishNotifications();
  useWarmCliAvailability();

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

  const minimalTheme = settings?.minimalTheme;

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
      if (projectId && activeFor(projectId)) toggleTerminalExpanded();
    },
    { capture: true },
  );
  useHotkey("nav.toggle", goHome);
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
        const pinned = (projects ?? []).filter((p) => p.pinned);
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
            height: 20,
            zIndex: 20,
            ["WebkitAppRegion" as any]: "drag",
          }}
        />
        <AgentSystemBanner
          dismissed={bannerDismissed}
          onDismiss={() => setBannerDismissed(true)}
          onOpenSettings={() => setActivePanel("settings")}
        />
        <TopBar
          crumbs={crumbs}
          onHome={goHome}
          leading={<LicenseBadge />}
          centerActions={<HeaderActionsSlot />}
          leadingInset={topBarLeadingInset}
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

function AgentSystemBanner({
  dismissed,
  onDismiss,
  onOpenSettings,
}: {
  dismissed: boolean;
  onDismiss: () => void;
  onOpenSettings: () => void;
}) {
  const { data: settings } = useSettings();

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
        onClick={onDismiss}
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
