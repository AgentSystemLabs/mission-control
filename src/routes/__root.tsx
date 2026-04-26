import { useEffect } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { TopBar, type Crumb } from "~/components/ui/TopBar";
import { Btn } from "~/components/ui/Btn";
import { Kbd, hotkeyLabel } from "~/components/ui/Kbd";
import { isEditableTarget, matchHotkey } from "~/lib/use-hotkey";
import { useTheme } from "~/lib/use-theme";
import { TerminalProvider, useTerminals } from "~/lib/terminal-store";
import {
  UserTerminalProvider,
  useUserTerminals,
} from "~/lib/user-terminal-store";
import { TerminalPanel } from "~/components/views/TerminalPanel";
import { UserTerminalPanel } from "~/components/views/UserTerminalPanel";
import { ProjectPicker } from "~/components/views/ProjectPicker";
import { TweaksLauncher } from "~/components/ui/TweaksPanel";
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
        <TerminalProvider>
          <UserTerminalProvider>
            <Shell />
          </UserTerminalProvider>
        </TerminalProvider>
        <Scripts />
      </body>
    </html>
  );
}

function Shell() {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { open, close, closeAll, setPtyId } = useTerminals();
  const userTerminals = useUserTerminals();

  const path = router.state.location.pathname;
  const projectMatch = path.match(/^\/projects\/([^/]+)/);
  const crumbs: Crumb[] = projectMatch
    ? [{ label: "Project", node: <ProjectPicker projectId={projectMatch[1]} /> }]
    : path === "/archive"
      ? [{ label: "Archive" }]
      : path === "/settings"
        ? [{ label: "Settings" }]
        : [{ label: "Project", node: <ProjectPicker /> }];

  const goHome = () => router.navigate({ to: "/" });

  // Cmd/Ctrl + [ / ] cycles through user terminals; opens panel if hidden.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Confirmation prompt — Enter confirms, Escape cancels. No modifier needed.
      if (userTerminals.pendingKillId && !isEditableTarget(e.target)) {
        if (e.key === "Enter") {
          e.preventDefault();
          userTerminals.confirmKill();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          userTerminals.cancelKill();
          return;
        }
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      // Mod-key bindings shouldn't fire while typing in inputs/textareas (would
      // accidentally launch terminals, navigate home, etc.).
      if (isEditableTarget(e.target)) return;
      // Cmd/Ctrl + W → request close of the focused user terminal (with confirm).
      // When the panel is closed or no terminal is focused we fall through to the
      // OS, which on macOS closes the window — that's the platform default.
      if ((e.key === "w" || e.key === "W") && userTerminals.panelOpen && userTerminals.focusedId) {
        e.preventDefault();
        userTerminals.requestKill(userTerminals.focusedId);
        return;
      }
      if (matchHotkey(e, "ctrl+`")) {
        e.preventDefault();
        userTerminals.togglePanel();
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        void userTerminals.createTerminal();
        return;
      }
      if (matchHotkey(e, "mod+m")) {
        e.preventDefault();
        router.navigate({ to: "/" });
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        userTerminals.cyclePrev();
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        userTerminals.cycleNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [userTerminals, router]);

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
                <Kbd variant="ghost">{hotkeyLabel("mod+m")}</Kbd>
              </Btn>
            )}
            {path !== "/" && (
              <Btn
                variant="ghost"
                icon="terminal"
                onClick={userTerminals.togglePanel}
                title="Toggle terminal panel"
              >
                Terminals
                <Kbd variant="ghost">{hotkeyLabel("ctrl+`")}</Kbd>
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
          <TerminalPanel
            open={open}
            onClose={close}
            onCloseAll={closeAll}
            onPtyReady={setPtyId}
          />
        </div>
        <UserTerminalPanel />
      </div>
      <TweaksLauncher />
    </div>
  );
}
