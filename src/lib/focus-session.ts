import { getElectron } from "~/lib/electron";

// Focused Session Mode entry/exit shared by TerminalPane (header button), the
// project route (hotkey), and the /focus route itself. Navigation happens
// before the window shrink so the full app never renders at floating size;
// on exit the window is restored first for the same reason in reverse.

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
  void router.navigate({ to: "/focus/$taskId", params: { taskId } });
  void getElectron()?.focusMode.enter(taskId);
}

export async function exitFocusSession(router: FocusRouterLike, taskId?: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (taskId) setPendingRefocus(taskId);
  // Restore the window before navigating so the project route mounts at the
  // full window size and terminal panes fit against real dimensions.
  try {
    await getElectron()?.focusMode.exit();
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
