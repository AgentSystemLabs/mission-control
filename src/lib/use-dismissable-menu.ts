import { useEffect, type RefObject } from "react";

/**
 * Electron drag regions (`-webkit-app-region: drag`, e.g. the top bar) are
 * handled natively by the OS and never dispatch DOM events, so a press there
 * is invisible to outside-press dismissal listeners. While a menu is open,
 * suspend dragging via a body attribute that styles.css turns into
 * `no-drag !important` — presses then land as normal events and dismiss the
 * menu. Ref-counted so overlapping menus don't re-enable drag early.
 */
let dragSuspendCount = 0;
const DRAG_SUSPEND_ATTR = "data-suspend-app-drag";

export function useSuspendAppDragRegion(active: boolean) {
  useEffect(() => {
    if (!active) return;
    dragSuspendCount += 1;
    document.body.setAttribute(DRAG_SUSPEND_ATTR, "");
    return () => {
      dragSuspendCount -= 1;
      if (dragSuspendCount === 0) document.body.removeAttribute(DRAG_SUSPEND_ATTR);
    };
  }, [active]);
}

/**
 * Dismiss an open menu on any pointer press outside `insideRef`, on Escape,
 * or on scroll. Listens in the capture phase so a `stopPropagation()` anywhere
 * in the tree (modal panels, cards, terminal panes) can't swallow the outside
 * event before it reaches window — the failure mode of the old bubble-phase
 * click listener, which left menus stuck open inside modals.
 *
 * `ContextMenuPopover` wires this up internally; only reach for this hook
 * directly when building a menu surface that can't use that shell.
 */
export function useDismissableMenu(
  open: boolean,
  close: () => void,
  insideRef?: RefObject<HTMLElement | null>,
) {
  useSuspendAppDragRegion(open);
  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) =>
      insideRef?.current != null &&
      target instanceof Node &&
      insideRef.current.contains(target);
    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target)) close();
    };
    const onScroll = (e: Event) => {
      if (!isInside(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close, insideRef]);
}
