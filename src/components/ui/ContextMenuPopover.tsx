import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CardFrame } from "~/components/ui/CardFrame";
import { Z_INDEX } from "~/lib/z-index";

/**
 * The shared portal shell for an anchored right-click context menu: a fixed,
 * elevated `CardFrame` positioned at `anchor` and rendered into `document.body`.
 * Callers own the open/close state (with `useDismissableMenu`) and supply the
 * menu items (`DropdownMenuItem` / `DropdownMenuSeparator`) as children.
 */
export function ContextMenuPopover({
  anchor,
  label,
  minWidth,
  children,
}: {
  anchor: { x: number; y: number };
  label: string;
  minWidth: number;
  children: ReactNode;
}) {
  return createPortal(
    <CardFrame
      role="menu"
      aria-label={label}
      solid
      className="mc-project-actions-menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: anchor.y,
        left: anchor.x,
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
