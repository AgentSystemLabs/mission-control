import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/DropdownMenuItem";
import { Icon } from "~/components/ui/Icon";
import { MenuLabel } from "~/components/ui/MenuLabel";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { api, ApiError } from "~/lib/api";
import { formatRelativeTime } from "~/lib/format-relative-time";
import { useScratchPad } from "~/lib/scratch-pad-store";
import { Z_INDEX } from "~/lib/z-index";
import { queryKeys, useScratchPads } from "~/queries";
import { scratchPadTitle, type ScratchPadView } from "~/shared/scratch-pads";

const MENU_WIDTH = 280;

/** Per-pad trash affordance; hover feedback to match sibling menu items. */
function PadTrashButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title="Remove scratch pad"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        border: 0,
        background: hover ? "var(--surface-2)" : "transparent",
        color: hover ? "var(--danger, #e5484d)" : "var(--text-dim)",
        cursor: "pointer",
      }}
    >
      <Icon name="trash" size={12} />
    </button>
  );
}

/**
 * TopBar entry point for scratch pads: click drops down the current project's
 * pads (open one, remove one, start a new one); the scratch.toggle hotkey
 * opens the most recent pad directly. Disabled outside a project page.
 */
export function ScratchPadButton() {
  const { projectId, openLatest, openNew, openPad } = useScratchPad();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const [confirmPad, setConfirmPad] = useState<ScratchPadView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  // Only fetch while the menu is open — the button itself needs no data.
  const { data: pads } = useScratchPads(menuOpen ? projectId : null);

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // Right-side header menu: hang from the button's right edge, clamped so a
    // narrow window never clips it.
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setMenuRect({ top: rect.bottom + 6, left });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [menuOpen, updateMenuRect]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const pick = (padId: string) => {
    setMenuOpen(false);
    openPad(padId);
  };

  const confirmDelete = async () => {
    if (!confirmPad || !projectId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteScratchPad(projectId, confirmPad.id);
      setConfirmPad(null);
    } catch (e) {
      // Already gone (deleted from another window) counts as success.
      if (e instanceof ApiError && e.status === 404) setConfirmPad(null);
      else setDeleteError(e instanceof Error ? e.message : "Failed to remove scratch pad");
    } finally {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scratchPads(projectId) });
      setDeleting(false);
    }
  };

  return (
    <div ref={anchorRef} style={{ display: "inline-flex", alignItems: "center" }}>
      <HotkeyTooltip action="scratch.toggle" label="Scratch pads">
        <Btn
          variant="ghost"
          icon="notepad"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={!projectId}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Scratch pads"
          style={menuOpen ? { background: "var(--surface-2)", color: "var(--text)" } : undefined}
        />
      </HotkeyTooltip>
      {menuOpen &&
        menuRect &&
        createPortal(
          <CardFrame
            ref={menuRef}
            role="menu"
            aria-label="Scratch pads"
            solid
            className="mc-project-actions-menu"
            style={{
              position: "fixed",
              top: menuRect.top,
              left: menuRect.left,
              width: MENU_WIDTH,
              boxSizing: "border-box",
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            <MenuLabel>Scratch pads</MenuLabel>
            {!pads ? (
              <div style={{ padding: "4px 12px 10px", fontSize: 11, color: "var(--text-dim)" }}>
                Loading…
              </div>
            ) : pads.length === 0 ? (
              <div style={{ padding: "4px 12px 10px", fontSize: 11, color: "var(--text-dim)" }}>
                No scratch pads yet for this project.
              </div>
            ) : (
              pads.map((pad) => (
                <div key={pad.id} style={{ display: "flex", alignItems: "stretch" }}>
                  <DropdownMenuItem
                    onClick={() => pick(pad.id)}
                    title={scratchPadTitle(pad.content)}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {scratchPadTitle(pad.content)}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          flexShrink: 0,
                          fontSize: 10,
                          color: "var(--text-faint)",
                        }}
                      >
                        {formatRelativeTime(pad.updatedAt)}
                      </span>
                    </span>
                  </DropdownMenuItem>
                  <PadTrashButton
                    label={`Remove scratch pad "${scratchPadTitle(pad.content)}"`}
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmPad(pad);
                    }}
                  />
                </div>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon="plus"
              onClick={() => {
                setMenuOpen(false);
                openNew();
              }}
            >
              New scratch pad
            </DropdownMenuItem>
            <DropdownMenuItem
              icon="notepad"
              onClick={() => {
                setMenuOpen(false);
                openLatest();
              }}
            >
              Open most recent
            </DropdownMenuItem>
          </CardFrame>,
          document.body,
        )}
      <ConfirmDialog
        open={confirmPad !== null}
        onClose={() => {
          setConfirmPad(null);
          setDeleteError(null);
        }}
        onConfirm={confirmDelete}
        title="Remove scratch pad?"
        confirmLabel="Remove"
        variant="danger"
        loading={deleting}
      >
        {confirmPad && (
          <>
            “{scratchPadTitle(confirmPad.content)}” will be permanently deleted from this
            project&apos;s scratch pads.
            {deleteError && (
              <div style={{ marginTop: 8, color: "var(--danger, #e5484d)", fontSize: 12 }}>
                {deleteError}
              </div>
            )}
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
