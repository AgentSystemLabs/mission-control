import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ILinkHandler, Terminal } from "@xterm/xterm";
import { getElectron } from "./electron";

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
}

/** True when the platform link modifier (Cmd on macOS, Ctrl elsewhere) is held. */
export function terminalLinkRequiresModifier(event: Pick<MouseEvent, "metaKey" | "ctrlKey">): boolean {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

export function openTerminalLink(uri: string): void {
  const electron = getElectron();
  if (electron?.openExternal) {
    void electron.openExternal(uri);
    return;
  }

  if (typeof document === "undefined") return;

  // Avoid window.open() — Electron's default popup path blocks the blank-window
  // trick xterm's built-in handler uses ("Opening link blocked as opener...").
  const anchor = document.createElement("a");
  anchor.href = uri;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

function createLinkActivateHandler(
  openLink: (uri: string) => void = openTerminalLink,
): (event: MouseEvent, uri: string) => void {
  return (event, uri) => {
    if (!terminalLinkRequiresModifier(event)) return;
    openLink(uri);
  };
}

export function createTerminalLinkHandler(
  openLink: (uri: string) => void = openTerminalLink,
): ILinkHandler {
  const activate = createLinkActivateHandler(openLink);
  return {
    activate(event, text) {
      activate(event, text);
    },
  };
}

/** Wire URL pattern links (WebLinksAddon) and OSC 8 hyperlinks with Cmd/Ctrl+Click. */
export function attachTerminalLinks(
  term: Terminal,
  openLink: (uri: string) => void = openTerminalLink,
): () => void {
  const activate = createLinkActivateHandler(openLink);
  term.options.linkHandler = createTerminalLinkHandler(openLink);
  const webLinks = new WebLinksAddon(activate);
  term.loadAddon(webLinks);
  return () => {
    webLinks.dispose();
    term.options.linkHandler = null;
  };
}
