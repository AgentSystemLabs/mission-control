import { useEffect } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { getElectron } from "~/lib/electron";
import { TopBar, type Crumb } from "~/components/ui/TopBar";
import { Btn } from "~/components/ui/Btn";
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
import "~/styles.css";

export const Route = createRootRoute({
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
              <Shell />
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
  const { active, close, setPtyId } = useTerminals();
  const userTerminals = useUserTerminals();

  useNavigationSwipe();

  const path = router.state.location.pathname;
  const projectMatch = path.match(/^\/projects\/([^/]+)/);
  const crumbs: Crumb[] = projectMatch
    ? [{ label: "Project", node: <ProjectPicker projectId={projectMatch[1]} /> }]
    : path === "/archive"
      ? [{ label: "Archive" }]
      : path.startsWith("/settings")
        ? [{ label: "Settings" }]
        : [{ label: "Project", node: <ProjectPicker /> }];

  const goHome = () => router.navigate({ to: "/" });

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
