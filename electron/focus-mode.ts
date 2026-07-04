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
  let transitioning = false;

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
    if (!win || win.isDestroyed() || transitioning) return publicState();
    if (state.active) {
      // Idempotent: renderer resync after reload, or switching focused session.
      state = { ...state, taskId };
      return publicState();
    }
    transitioning = true;
    try {
      const prev = {
        bounds: win.getNormalBounds(),
        isMaximized: win.isMaximized(),
        isFullScreen: win.isFullScreen(),
      };
      if (prev.isFullScreen) await leaveFullScreen(win);
      else if (prev.isMaximized) win.unmaximize();

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
      const activeWorkArea = screen.getDisplayMatching(prev.bounds).workArea;
      win.setBounds(resolveFloatingBounds(saved, workAreas, activeWorkArea));

      win.once("closed", onClosed);
      state = { active: true, taskId, alwaysOnTop, prev };
      log.info("focusMode.enter", { taskId });
      return publicState();
    } finally {
      transitioning = false;
    }
  };

  const exit = (): FocusModePublicState => {
    if (!state.active || transitioning) return publicState();
    const prev = state.prev;
    const win = getWin();
    if (!win || win.isDestroyed()) {
      state = { active: false };
      return publicState();
    }
    transitioning = true;
    try {
      persistFloatingBounds(win);
      win.setAlwaysOnTop(false);
      win.setMinimumSize(mainMinSize.width, mainMinSize.height);
      win.setMaximizable(true);
      win.setMinimizable(true);
      win.setFullScreenable(true);
      if (process.platform === "darwin") win.setWindowButtonVisibility(true);
      win.setBounds(prev.bounds);
      if (prev.isFullScreen) win.setFullScreen(true);
      else if (prev.isMaximized) win.maximize();
      win.removeListener("closed", onClosed);
      state = { active: false };
      log.info("focusMode.exit");
      return publicState();
    } finally {
      transitioning = false;
    }
  };

  safeHandle(IPC.appEnterFocusMode, (_e, payload: { taskId?: unknown }) => {
    const taskId = payload?.taskId;
    if (typeof taskId !== "string" || taskId.length === 0) return publicState();
    return enter(taskId);
  });

  safeHandle(IPC.appExitFocusMode, () => exit());

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
