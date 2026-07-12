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
// Last full pet state pushed by the main window (the source of truth). Served
// to the overlay renderer on mount, so a freshly (re)loaded overlay paints the
// current pet instead of waiting for the next state change.
let lastMirror: unknown = null;
// Snapshot-only pushes omit the unchanged `identity` blob; remember the last
// one seen so the cached `lastMirror` served to a fresh overlay stays complete.
let lastIdentity: unknown = null;
// Monotonic stamp on every mirror relay so the overlay can drop a stale/late
// delivery (see PetOverlayMirrorPayload.seq). Never resets — always climbs.
let mirrorSeq = 0;

// The interaction kinds the overlay may forward (mirror of the PetOverlayAction
// union in src/shared/pet.ts). Anything else is rejected before it reaches the
// authoritative store.
const OVERLAY_ACTION_KINDS = new Set([
  "interact",
  "stroke",
  "grabbed",
  "tossed",
  "stats-open",
  "molt",
]);

type NormalizedOverlayAction = {
  kind: string;
  alert?: boolean;
  x?: number;
  open?: boolean;
};

// Validate a renderer-supplied action into a known shape (or null). Keeps a
// malformed/injected payload from ever reaching main.show()/focus() or the
// authoritative store; the numeric drop coordinates must be finite.
function normalizeOverlayAction(raw: unknown): NormalizedOverlayAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== "string" || !OVERLAY_ACTION_KINDS.has(r.kind)) return null;
  const action: NormalizedOverlayAction = { kind: r.kind };
  if (r.kind === "interact") action.alert = r.alert === true;
  if (r.kind === "grabbed" || r.kind === "tossed") {
    if (typeof r.x !== "number" || !Number.isFinite(r.x)) return null;
    action.x = r.x;
  }
  if (r.kind === "stats-open") action.open = r.open === true;
  return action;
}

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
    // Already closed (the common default-off boot): nothing to tear down and
    // no state change to broadcast.
    if (!enabled && (!overlayWin || overlayWin.isDestroyed())) return;
    enabled = false;
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
    overlayWin = null;
    broadcast();
  };

  const open = () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      // Already open and enabled: the window is shown and the state already
      // broadcast, so skip the redundant showInactive + broadcast.
      if (enabled) return;
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

    // Containment — mirror the main window (electron/main.ts). The overlay loads
    // the FULL preload bridge yet floats always-on-top across every Space, so a
    // renderer compromise here must not be able to open child windows or
    // navigate away from the pinned app origin. Deny all window opens and block
    // any navigation other than (re)loading the overlay URL itself.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, navUrl) => {
      if (navUrl !== overlayUrl) event.preventDefault();
    });

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

  // The MAIN window owns the pet (store, controller, persistence); the overlay
  // only renders. Relay each full-state push main → overlay, and remember the
  // latest so a freshly loaded overlay can pull it immediately.
  safeHandle(IPC.petOverlayPushMirror, (_e, payload: unknown) => {
    const p = payload as Record<string, unknown> | null;
    // Structural guard: a mirror must be an object carrying a snapshot object.
    // Anything else is malformed — don't cache or forward it.
    if (!p || typeof p !== "object" || !p.snapshot || typeof p.snapshot !== "object") {
      return { ok: false };
    }
    const hasIdentity = "identity" in p;
    if (hasIdentity) lastIdentity = p.identity;
    // Stamp a monotonic seq so the overlay can order a live push against a late
    // getMirror reply (Electron doesn't guarantee invoke/on ordering). Forward
    // the (possibly identity-less) payload to the live overlay — it keeps the
    // identity it already holds — but cache a COMPLETE one (identity refilled)
    // so a freshly (re)loaded overlay's getMirror still returns the identity.
    const forwarded = { ...p, seq: ++mirrorSeq };
    lastMirror = hasIdentity ? forwarded : { ...forwarded, identity: lastIdentity };
    if (!overlayWin || overlayWin.isDestroyed()) return { ok: false };
    overlayWin.webContents.send(IPC.petOverlayMirrorEvent, forwarded);
    return { ok: true };
  });

  safeHandle(IPC.petOverlayGetMirror, () => lastMirror);

  // Relay a user interaction on the desktop pet (petting, toss, stats card…)
  // overlay → MAIN window, whose store is the single source of truth. Clicking
  // an alerted pet jumps to the blocked session, so surface the main window
  // for that one — every other interaction must not steal focus.
  safeHandle(IPC.petOverlayAction, (_e, raw: unknown) => {
    const main = getMainWin();
    if (!main || main.isDestroyed()) return { ok: false };
    const action = normalizeOverlayAction(raw);
    if (!action) return { ok: false };
    // Only a click on a genuinely-alerted pet may surface the main window.
    // Corroborate the relayed flag against the last mirrored state so a forged
    // `alert:true` can't pull focus on demand; the read is fully guarded and
    // fails CLOSED (no surfacing) on any unexpected snapshot shape.
    if (action.kind === "interact" && action.alert && cachedPetIsAlerted()) {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    }
    main.webContents.send(IPC.petOverlayActionEvent, action);
    return { ok: true };
  });
}

// Defensive, shape-tolerant read of the cached mirror's alert state. The
// snapshot is renderer-owned and opaque at the bridge, so this never throws and
// treats any unexpected shape as "not alerted" — the only cost of a future
// snapshot-shape change is that jump-to-session stops raising the window, which
// is a safe (non-security) degradation rather than a focus-steal opening.
function cachedPetIsAlerted(): boolean {
  const mirror = lastMirror as { snapshot?: unknown } | null;
  const snap = mirror?.snapshot as { mood?: unknown; alert?: unknown } | null | undefined;
  return !!snap && snap.mood === "alert" && snap.alert != null;
}
