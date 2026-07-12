import type { BrowserWindow as BrowserWindowType } from "electron";
import { BrowserWindow, screen } from "electron";
import path from "node:path";
import log from "electron-log/main";
import { IPC } from "./ipc-channels";
import { safeHandle } from "./ipc-safe-handle";

// Desktop Pet Overlay (spike): "unleash" the Mission Pet out of the app window
// and onto the desktop itself. A separate transparent, frameless, always-on-top
// BrowserWindow spans the primary display's work area and floats above every
// other app — so the pet stays visible when you switch apps, minimize Mission
// Control, or go fullscreen elsewhere.
//
// The overlay is fully click-through (`setIgnoreMouseEvents(true, {forward:true})`)
// so clicks fall through to whatever is underneath — EXCEPT while the cursor is
// over the sprite, where the renderer flips it interactive via
// `petOverlay:set-interactive` so the pet stays draggable/strokeable/clickable.
// The renderer detects overlay mode from the `?overlay=pet` query param and
// renders only the pet (no shell).

let overlayWin: BrowserWindowType | null = null;
let enabled = false;

export type PetOverlayStatePublic = { enabled: boolean };

export function registerPetOverlay(
  getMainWin: () => BrowserWindowType | null,
  getAppUrl: () => string | null,
): void {
  const publicState = (): PetOverlayStatePublic => ({ enabled });

  const broadcast = () => {
    // The main window hides its in-window pet while the overlay owns it.
    const main = getMainWin();
    if (main && !main.isDestroyed()) {
      main.webContents.send(IPC.petOverlayStateChange, publicState());
    }
  };

  const close = () => {
    enabled = false;
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
    overlayWin = null;
    broadcast();
  };

  const open = () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      enabled = true;
      overlayWin.showInactive();
      broadcast();
      return;
    }
    const appUrl = getAppUrl();
    if (!appUrl) {
      log.warn("petOverlay.open.noAppUrl");
      return;
    }
    const workArea = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      backgroundColor: "#00000000",
      // No traffic lights / title bar — the overlay is pure sprite.
      titleBarStyle: "customButtonsOnHover",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    overlayWin = win;
    enabled = true;

    // Float above everything, follow the user across Spaces, and let mouse
    // events pass through to the apps beneath (forwarded so the renderer can
    // still hit-test the sprite and toggle interactivity).
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });

    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.showInactive();
    });
    win.on("closed", () => {
      if (overlayWin === win) {
        overlayWin = null;
        if (enabled) {
          enabled = false;
          broadcast();
        }
      }
    });

    const overlayUrl = `${appUrl}${appUrl.includes("?") ? "&" : "?"}overlay=pet`;
    win.loadURL(overlayUrl).catch((err) => {
      log.error("petOverlay.load.failed", { err: String(err) });
    });
    broadcast();
    log.info("petOverlay.open", { overlayUrl });
  };

  safeHandle(IPC.petOverlayGetState, () => publicState());

  safeHandle(IPC.petOverlaySetEnabled, (_e, payload: { enabled?: unknown }) => {
    if (payload?.enabled === true) open();
    else close();
    return publicState();
  });

  // Called from the overlay renderer as the cursor enters/leaves the sprite:
  // interactive=true captures the mouse so the pet is draggable; false returns
  // the window to click-through so the desktop underneath stays usable.
  safeHandle(IPC.petOverlaySetInteractive, (_e, payload: { interactive?: unknown }) => {
    if (!overlayWin || overlayWin.isDestroyed()) return { ok: false };
    const interactive = payload?.interactive === true;
    overlayWin.setIgnoreMouseEvents(!interactive, { forward: true });
    return { ok: true };
  });

  // Relay a pet design change (species/size/name) from the MAIN window to the
  // overlay, which owns the live desktop pet — otherwise edits made in Settings
  // never reach the unleashed pet.
  safeHandle(IPC.petOverlayApplyDesign, (_e, patch: unknown) => {
    if (!overlayWin || overlayWin.isDestroyed()) return { ok: false };
    overlayWin.webContents.send(IPC.petOverlayDesignEvent, patch);
    return { ok: true };
  });
}
