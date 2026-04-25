import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { TopBar, type Crumb } from "~/components/ui/TopBar";
import { Btn } from "~/components/ui/Btn";
import { useTheme } from "~/lib/use-theme";
import { TerminalProvider, useTerminals } from "~/lib/terminal-store";
import { TerminalPanel } from "~/components/views/TerminalPanel";
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
          <Shell />
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

  const path = router.state.location.pathname;
  const crumbs: Crumb[] = path.startsWith("/projects/")
    ? [{ label: "Project" }]
    : path === "/archive"
      ? [{ label: "Archive" }]
      : path === "/settings"
        ? [{ label: "Settings" }]
        : [];

  const goHome = () => router.navigate({ to: "/" });

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
      <TweaksLauncher />
    </div>
  );
}
