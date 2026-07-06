import { getElectron } from "~/lib/electron";

// Focused Session Mode entry/exit shared by TerminalPane (header button), the
// project route (hotkey), and the /focus route itself. The window transform is
// animated (electron/focus-mode.ts), so sequencing is what makes it read as
// the same session collapsing/expanding: entry commits the /focus navigation
// BEFORE the shrink starts (the focus card is what animates down, never the
// full app squeezed into a shrinking window), and exit restores the window
// first — the card grows back while still showing the session — navigating
// only once the window has landed at full size.

export const FOCUS_RETURN_KEY = "mc.focusMode.returnTo";

export type FocusRouterLike = {
  navigate: (opts: { to: string; params?: { taskId: string } }) => Promise<void> | void;
  history: { push: (href: string) => void };
  state: { location: { href: string; pathname: string } };
};

export function isFocusPath(pathname: string): boolean {
  return pathname === "/focus" || pathname.startsWith("/focus/");
}

// Consume-once flag asking the next TerminalPane that mounts `taskId` to grab
// keyboard focus, so typing continues across both focus-mode transitions
// without a click. Time-boxed: a transition whose pane never mounts (exit fell
// back to home) must not steal focus from something the user opened later.
const REFOCUS_WINDOW_MS = 3_000;
let pendingRefocus: { taskId: string; expires: number } | null = null;

export function setPendingRefocus(taskId: string): void {
  pendingRefocus = { taskId, expires: Date.now() + REFOCUS_WINDOW_MS };
}

export function takePendingRefocus(taskId: string): boolean {
  if (!pendingRefocus) return false;
  if (Date.now() > pendingRefocus.expires) {
    pendingRefocus = null;
    return false;
  }
  if (pendingRefocus.taskId !== taskId) return false;
  pendingRefocus = null;
  return true;
}

/** Where exiting focus mode should land. Falls back to home when nothing
 *  usable was stored (fresh reload cleared sessionStorage, or the stored
 *  path is itself a focus path and would bounce right back). */
export function resolveReturnPath(stored: string | null): string {
  if (!stored || !stored.startsWith("/") || isFocusPath(stored)) return "/";
  return stored;
}

/**
 * Switch the focused session in place. The floating window is never recreated —
 * only the route param changes, so the header/session-bar re-render and the
 * TerminalPane re-keys onto the new session (its xterm surface is cached, so
 * the swap is instant with no scrollback replay). `enter` is idempotent on the
 * main process: it just updates which taskId the floating window is showing.
 */
export function switchFocusSession(router: FocusRouterLike, taskId: string): void {
  if (typeof window === "undefined") return;
  setPendingRefocus(taskId);
  void router.navigate({ to: "/focus/$taskId", params: { taskId } });
  void getElectron()?.focusMode.enter(taskId);
}

export function enterFocusSession(router: FocusRouterLike, taskId: string): void {
  if (typeof window === "undefined") return;
  if (!isFocusPath(router.state.location.pathname)) {
    try {
      window.sessionStorage.setItem(FOCUS_RETURN_KEY, router.state.location.href);
    } catch {
      /* private mode etc. — exit will fall back to home */
    }
  }
  setPendingRefocus(taskId);
  // Await the route swap before transforming the window: the shrink is
  // animated, and starting it while the full app is still rendered would
  // visibly squeeze that UI into the card for the first frames. If navigation
  // fails, the window is left alone.
  void Promise.resolve(router.navigate({ to: "/focus/$taskId", params: { taskId } }))
    .then(() => getElectron()?.focusMode.enter(taskId))
    .catch(() => undefined);
}

export async function exitFocusSession(router: FocusRouterLike, taskId?: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (taskId) setPendingRefocus(taskId);
  // Restore the window before navigating so the project route mounts at the
  // full window size and terminal panes fit against real dimensions. exit()
  // resolves only once the (animated) restore has landed.
  try {
    const state = await getElectron()?.focusMode.exit();
    // Still active means the main process didn't restore the window (it can't
    // while it's being torn down, say) — navigating now would render the full
    // app inside the floating card, so stay on the focus route.
    if (state?.active) return;
  } catch {
    /* window restore failed (window gone?) — still leave the focus route */
  }
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(FOCUS_RETURN_KEY);
    window.sessionStorage.removeItem(FOCUS_RETURN_KEY);
  } catch {
    /* fall through to home */
  }
  router.history.push(resolveReturnPath(stored));
}
