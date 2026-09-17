import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CardFrame } from "~/components/ui/CardFrame";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { Z_INDEX } from "~/lib/z-index";

const VIEWPORT_MARGIN = 8;

/**
 * The shared portal shell for an anchored right-click context menu: a fixed,
 * elevated `CardFrame` positioned at `anchor` and rendered into `document.body`.
 * Dismissal is built in — outside pointer press, Escape, and scroll all call
 * `onClose` — so callers only own the open state and supply the menu items
 * (`DropdownMenuItem` / `DropdownMenuSeparator`) as children. The menu is
 * measured before paint and clamped to the window, so an anchor near an edge
 * (e.g. right-clicking a top-bar icon) can't push it off screen.
 */
export function ContextMenuPopover({
  anchor,
  label,
  minWidth,
  onClose,
  children,
}: {
  anchor: { x: number; y: number };
  label: string;
  minWidth: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLElement>(null);
  useDismissableMenu(true, onClose, menuRef);

  const [pos, setPos] = useState(anchor);
  // Children are a dep so a content swap (e.g. ProjectCard's "Move to group"
  // mode) re-measures; our own setPos re-render leaves them stable, so this
  // can't loop.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchor.x, window.innerWidth - rect.width - VIEWPORT_MARGIN),
    );
    const y = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchor.y, window.innerHeight - rect.height - VIEWPORT_MARGIN),
    );
    setPos((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
  }, [anchor.x, anchor.y, children]);

  return createPortal(
    <CardFrame
      ref={menuRef}
      role="menu"
      aria-label={label}
      solid
      className="mc-project-actions-menu"
      // Portaled children still bubble synthetic events through the React
      // tree, so without this a menu-item click would also fire the owner's
      // onClick (e.g. a ProjectCard navigating).
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: pos.y,
        left: pos.x,
        minWidth,
        boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
        zIndex: Z_INDEX.popover,
      }}
    >
      {children}
    </CardFrame>,
    document.body,
  );
}
