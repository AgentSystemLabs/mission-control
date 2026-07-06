import { prefetchTerminalWebgl } from "./terminal-webgl";

type TerminalModuleBundle = {
  Terminal: typeof import("@xterm/xterm").Terminal;
  FitAddon: typeof import("@xterm/addon-fit").FitAddon;
};

let prefetch: Promise<TerminalModuleBundle> | null = null;

/** Load xterm modules + font metrics ahead of the first visible session panel. */
export function prefetchTerminalModules(): Promise<TerminalModuleBundle> {
  if (!prefetch) {
    prefetch = (async () => {
      const [{ Terminal }, { FitAddon }, { waitForTerminalFont }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("./terminal-options"),
      ]);
      // Warm the WebGL renderer chunk in the background; terminals open on the
      // DOM renderer and upgrade to GPU once their lease attaches.
      prefetchTerminalWebgl();
      await waitForTerminalFont();
      return { Terminal, FitAddon };
    })();
  }
  return prefetch;
}
