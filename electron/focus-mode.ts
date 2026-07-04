import type { BrowserWindow, Rectangle } from "electron";
import { app, screen } from "electron";
import log from "electron-log/main";
import { getStringAppSetting, setAppSetting } from "./app-settings-store";
import { IPC } from "./ipc-channels";
import { safeHandle } from "./ipc-safe-handle";

// Focused Session Mode: the single main window transforms into a small
// always-on-top floating card showing one session, and back. State lives here
// in main-process memory — it survives renderer reloads (the renderer resyncs
// via app:getFocusMode / an idempotent enter) and resets on app relaunch.
//
// The transform is ANIMATED on macOS (setBounds with animate) so entering
// reads as the session collapsing into the card and exiting as it expanding
// back — never a jump-cut that hides one window and shows another. The
// renderer sequences its route swap around this: it navigates to /focus
// BEFORE calling enter (the card content is what shrinks) and navigates back
// only after exit resolves at the final geometry (see lib/focus-session.ts).

export const FOCUS_WINDOW_DEFAULT_WIDTH = 560;
export const FOCUS_WINDOW_DEFAULT_HEIGHT = 850;
export const FOCUS_WINDOW_MIN_WIDTH = 320;
export const FOCUS_WINDOW_MIN_HEIGHT = 220;
export const FOCUS_WINDOW_MARGIN = 24;
// :v2 — the default card size changed pre-release; bounds saved under the old
// key would keep overriding the new default, so start a fresh key.
export const FLOATING_BOUNDS_KEY = "focusMode:floatingBounds:v2";
export const ALWAYS_ON_TOP_KEY = "focusMode:alwaysOnTop";

// Persisted bounds are reused only while at least this much of the card is
// still visible on some display (a monitor may have been unplugged since).
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 40;

// The macOS animated setBounds has no completion callback, so we poll until
// the frame lands (with a backstop for an interrupted/never-finishing
// animation). NSWindow's default resize animation is ~0.2s.
const ANIMATION_POLL_MS = 16;
const ANIMATION_TIMEOUT_MS = 800;

/** Whether an animated bounds change has landed on its target (±1px for
 *  display-scaling rounding). */
export function boundsSettled(current: Rectangle, target: Rectangle): boolean {
  return (
    Math.abs(current.x - target.x) <= 1 &&
    Math.abs(current.y - target.y) <= 1 &&
    Math.abs(current.width - target.width) <= 1 &&
    Math.abs(current.height - target.height) <= 1
  );
}

export type FocusModePublicState = {
  active: boolean;
  taskId: string | null;
  alwaysOnTop: boolean;
};

type FocusModeState =
  | { active: false }
  | {
      active: true;
      taskId: string;
      alwaysOnTop: boolean;
      prev: { bounds: Rectangle; isMaximized: boolean; isFullScreen: boolean };
    };

export function defaultFloatingBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(FOCUS_WINDOW_DEFAULT_WIDTH, workArea.width);
  const height = Math.min(FOCUS_WINDOW_DEFAULT_HEIGHT, workArea.height);
  return {
    x: Math.max(workArea.x, workArea.x + workArea.width - width - FOCUS_WINDOW_MARGIN),
    y: Math.max(workArea.y, workArea.y + workArea.height - height - FOCUS_WINDOW_MARGIN),
    width,
    height,
  };
}

export function parsePersistedBounds(raw: string | null): Rectangle | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { x, y, width, height } = parsed as Record<string, unknown>;
  const nums = [x, y, width, height];
  if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const bounds = {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(width as number),
    height: Math.round(height as number),
  };
  if (bounds.width < FOCUS_WINDOW_MIN_WIDTH || bounds.height < FOCUS_WINDOW_MIN_HEIGHT) return null;
  return bounds;
}

export function resolveFloatingBounds(
  saved: Rectangle | null,
  displayWorkAreas: readonly Rectangle[],
  activeWorkArea: Rectangle,
): Rectangle {
  if (saved) {
    const visible = displayWorkAreas.some((wa) => {
      const overlapW = Math.min(saved.x + saved.width, wa.x + wa.width) - Math.max(saved.x, wa.x);
      const overlapH = Math.min(saved.y + saved.height, wa.y + wa.height) - Math.max(saved.y, wa.y);
      return overlapW >= MIN_VISIBLE_WIDTH && overlapH >= MIN_VISIBLE_HEIGHT;
    });
    if (visible) return saved;
  }
  return defaultFloatingBounds(activeWorkArea);
}

export function registerFocusMode(
  getWin: () => BrowserWindow | null,
  userDataDir: string,
  mainMinSize: { width: number; height: number },
): void {
  let state: FocusModeState = { active: false };

  // Enter/exit are serialized: with the transform animating for ~300ms, a
  // second toggle mid-flight (double-tap peek) must queue behind the current
  // transition rather than interleave window ops or get dropped. Back-to-back
  // duplicates collapse via the state checks at the top of enter/exit.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op, op);
    queue = run.catch(() => undefined);
    return run;
  };

  // Animated bounds change — macOS morphs the window frame; on other
  // platforms the animate flag is a no-op and the change is instant. Resolves
  // once the window has landed so callers can sequence chrome restoration,
  // maximize, and the renderer's route swap against the final geometry.
  const setBoundsAnimated = (win: BrowserWindow, target: Rectangle): Promise<void> => {
    win.setBounds(target, true);
    if (process.platform !== "darwin") return Promise.resolve();
    return new Promise((resolve) => {
      const deadline = Date.now() + ANIMATION_TIMEOUT_MS;
      const tick = () => {
        if (
          win.isDestroyed() ||
          boundsSettled(win.getBounds(), target) ||
          Date.now() >= deadline
        ) {
          resolve();
          return;
        }
        setTimeout(tick, ANIMATION_POLL_MS);
      };
      tick();
    });
  };

  const publicState = (): FocusModePublicState =>
    state.active
      ? { active: true, taskId: state.taskId, alwaysOnTop: state.alwaysOnTop }
      : { active: false, taskId: null, alwaysOnTop: false };

  // Native close while floating (win/linux close button, app teardown): the
  // saved prev-bounds die with the window, so just drop the state.
  const onClosed = () => {
    state = { active: false };
  };

  const persistFloatingBounds = (win: BrowserWindow) => {
    try {
      setAppSetting(userDataDir, FLOATING_BOUNDS_KEY, JSON.stringify(win.getBounds()));
    } catch (err) {
      log.warn("focusMode.persistBounds.failed", { err: String(err) });
    }
  };

  const leaveFullScreen = (win: BrowserWindow): Promise<void> =>
    new Promise((resolve) => {
      // macOS animates the fullscreen exit; resizing mid-animation misplaces
      // the window. Wait for leave-full-screen, with a timeout backstop in
      // case the event never fires.
      const done = () => {
        clearTimeout(timer);
        win.removeListener("leave-full-screen", done);
        resolve();
      };
      const timer = setTimeout(done, 2_000);
      win.once("leave-full-screen", done);
      win.setFullScreen(false);
    });

  const enter = async (taskId: string): Promise<FocusModePublicState> => {
    const win = getWin();
    if (!win || win.isDestroyed()) return publicState();
    if (state.active) {
      // Idempotent: renderer resync after reload, or switching focused session.
      state = { ...state, taskId };
      return publicState();
    }
    // What's on screen right now (maximized/fullscreen frame included): the
    // collapse must animate from this, not from the smaller normal bounds.
    const visibleBounds = win.getBounds();
    const prev = {
      bounds: win.getNormalBounds(),
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
    };
    if (prev.isFullScreen) {
      await leaveFullScreen(win);
      if (win.isDestroyed()) return publicState();
    } else if (prev.isMaximized) {
      // unmaximize snaps the window back to its old normal bounds; re-cover
      // the maximized frame in the same tick (nothing paints in between) so
      // the collapse starts from what the user was actually looking at.
      win.unmaximize();
      win.setBounds(visibleBounds);
    }

    const alwaysOnTop = getStringAppSetting(userDataDir, ALWAYS_ON_TOP_KEY) !== "false";
    win.setMinimumSize(FOCUS_WINDOW_MIN_WIDTH, FOCUS_WINDOW_MIN_HEIGHT);
    win.setAlwaysOnTop(alwaysOnTop, "floating");
    // Strip every OS window control while floating: only the session card's
    // own chrome is visible, and nothing can accidentally re-expand it.
    win.setMaximizable(false);
    win.setMinimizable(false);
    win.setFullScreenable(false);
    if (process.platform === "darwin") win.setWindowButtonVisibility(false);

    const saved = parsePersistedBounds(getStringAppSetting(userDataDir, FLOATING_BOUNDS_KEY));
    const workAreas = screen.getAllDisplays().map((d) => d.workArea);
    const activeWorkArea = screen.getDisplayMatching(visibleBounds).workArea;

    win.once("closed", onClosed);
    state = { active: true, taskId, alwaysOnTop, prev };
    log.info("focusMode.enter", { taskId });
    // Collapse into the floating card. State is committed before the await so
    // a renderer resync mid-animation already sees focus mode active.
    await setBoundsAnimated(win, resolveFloatingBounds(saved, workAreas, activeWorkArea));
    return publicState();
  };

  const exit = async (): Promise<FocusModePublicState> => {
    if (!state.active) return publicState();
    const prev = state.prev;
    const win = getWin();
    if (!win || win.isDestroyed()) {
      state = { active: false };
      return publicState();
    }
    persistFloatingBounds(win);
    win.setAlwaysOnTop(false);
    // Expand back to the frame the user will end up looking at: the work area
    // when the window was maximized (macOS only — elsewhere the transform is
    // instant and maximize() below does the real work), else the saved normal
    // bounds. The focus card is still rendered while this animates, so the
    // session stays visible the whole way out.
    const landing =
      prev.isMaximized && process.platform === "darwin"
        ? screen.getDisplayMatching(prev.bounds).workArea
        : prev.bounds;
    await setBoundsAnimated(win, landing);
    if (win.isDestroyed()) {
      // Closed mid-animation; the `closed` listener already dropped the state.
      return publicState();
    }
    win.setMinimumSize(mainMinSize.width, mainMinSize.height);
    win.setMaximizable(true);
    win.setMinimizable(true);
    win.setFullScreenable(true);
    if (process.platform === "darwin") win.setWindowButtonVisibility(true);
    if (prev.isFullScreen) win.setFullScreen(true);
    else if (prev.isMaximized) win.maximize();
    win.removeListener("closed", onClosed);
    state = { active: false };
    log.info("focusMode.exit");
    return publicState();
  };

  safeHandle(IPC.appEnterFocusMode, (_e, payload: { taskId?: unknown }) => {
    const taskId = payload?.taskId;
    if (typeof taskId !== "string" || taskId.length === 0) return publicState();
    return enqueue(() => enter(taskId));
  });

  safeHandle(IPC.appExitFocusMode, () => enqueue(() => exit()));

  safeHandle(IPC.appGetFocusMode, () => publicState());

  safeHandle(IPC.appSetFocusModeAlwaysOnTop, (_e, payload: { enabled?: unknown }) => {
    const enabled = payload?.enabled === true;
    const win = getWin();
    if (!state.active || !win || win.isDestroyed()) return publicState();
    win.setAlwaysOnTop(enabled, "floating");
    state = { ...state, alwaysOnTop: enabled };
    setAppSetting(userDataDir, ALWAYS_ON_TOP_KEY, enabled ? "true" : "false");
    return publicState();
  });

  app.on("before-quit", () => {
    const win = getWin();
    if (state.active && win && !win.isDestroyed()) persistFloatingBounds(win);
  });
}
