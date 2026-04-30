import { useEffect, useState } from "react";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Link,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { getElectron } from "~/lib/electron";
import { TopBar, type Crumb } from "~/components/ui/TopBar";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { KbdAction } from "~/components/ui/Kbd";
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
import { AddProjectProvider } from "~/lib/add-project-store";
import { useSettings } from "~/queries";
import { applyAccentColor, DEFAULT_ACCENT_COLOR } from "~/lib/accent-colors";
import "~/styles.css";

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
  const { theme, toggle } = useTheme();
  const { data: settings } = useSettings();
  const { active, close, setPtyId } = useTerminals();
  const userTerminals = useUserTerminals();

  useNavigationSwipe();

  const path = router.state.location.pathname;
  const projectMatch = path.match(/^\/projects\/([^/]+)/);
  const crumbs: Crumb[] = projectMatch
    ? [{ label: "Project", node: <ProjectPicker projectId={projectMatch[1]} /> }]
    : path.startsWith("/settings")
      ? [{ label: "Settings" }]
      : [{ label: "Project", node: <ProjectPicker /> }];

  const goHome = () => router.navigate({ to: "/" });

  useEffect(() => {
    applyAccentColor(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
  }, [settings?.accentColor]);

  useHotkey("terminal.toggle", () => userTerminals.togglePanel());
  useHotkey("nav.toggle", () => router.navigate({ to: "/" }));
  // Cmd/Ctrl + [ / ] / T are non-rebindable terminal-focused shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if ((e.key === "t" || e.key === "T") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void userTerminals.createTerminal();
        return;
      }
      if (e.key === "[" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        userTerminals.cyclePrev();
        return;
      }
      if (e.key === "]" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        userTerminals.cycleNext();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [userTerminals]);

  // Cmd/Ctrl+W is intercepted in the Electron main process (otherwise the
  // default app menu's "Close Window" item closes the BrowserWindow before any
  // renderer handler runs). The main process forwards an `app:close-intent`
  // event; we close the focused user terminal if the panel is open.
  useEffect(() => {
    const electron = getElectron();
    if (!electron) return;
    return electron.onCloseIntent(() => {
      if (userTerminals.panelOpen && userTerminals.focusedId) {
        void userTerminals.killTerminal(userTerminals.focusedId);
      }
    });
  }, [userTerminals]);

  return (
    <div id="root">
      <AgentSystemBanner />
      <TopBar
        crumbs={crumbs}
        onHome={goHome}
        right={
          <>
            {path !== "/" && (
              <Btn variant="ghost" icon="home" onClick={goHome}>
                Mission Control
                <KbdAction action="nav.toggle" />
              </Btn>
            )}
            <Btn
              variant="ghost"
              icon="settings"
              onClick={() => router.navigate({ to: "/settings" })}
            >
              Settings
            </Btn>
            <button
              onClick={toggle}
              title={theme === "dark" ? "Switch to light" : "Switch to dark"}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--text-faint)",
                padding: "2px 7px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "transparent",
                cursor: "pointer",
              }}
            >
              {theme === "dark" ? "☼" : "☽"}
            </button>
          </>
        }
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Outlet />
          </div>
          {projectMatch && (
            <TerminalPanel
              active={
                active && active.project.id === projectMatch[1] ? active : null
              }
              onClose={close}
              onPtyReady={setPtyId}
            />
          )}
        </div>
        <UserTerminalPanel />
      </div>
    </div>
  );
}

function AgentSystemBanner() {
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
        background:
          "linear-gradient(90deg, rgba(255, 90, 31, 0.22), rgba(14, 16, 19, 0.98) 34%, rgba(255, 90, 31, 0.14))",
        borderBottom: "1px solid var(--border-strong)",
        color: "var(--text)",
        flexShrink: 0,
        position: "relative",
        zIndex: 11,
        ["WebkitAppRegion" as any]: "no-drag",
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
          background: "var(--accent-dim)",
          color: "var(--accent)",
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
          color: "var(--text-dim)",
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
            color: "var(--accent)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          AgentSystem.dev
        </a>
        .
        <Link
          to="/settings/general"
          style={{
            marginLeft: 8,
            color: "var(--text-faint)",
            fontSize: 11.5,
            fontWeight: 500,
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          Disable banner in settings
        </Link>
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
          background: "rgba(255, 255, 255, 0.03)",
          color: "var(--text-dim)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
