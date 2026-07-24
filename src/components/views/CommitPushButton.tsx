import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { DropdownMenuItem } from "~/components/ui/DropdownMenuItem";
import { Icon } from "~/components/ui/Icon";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { Z_INDEX } from "~/lib/z-index";
import { VOICE_SHIP_EVENT } from "~/lib/voice-events";

export function CommitPushButton({
  label = "Ship",
  title,
  variant = "primary",
  size = "sm",
  splitTrailing = false,
  attachedLeading = false,
  enabled = true,
  onShip,
  onCreatePullRequest,
}: {
  label?: string;
  title?: string;
  variant?: "primary" | "ghost" | "gray-frame";
  size?: "sm" | "md";
  /** Right segment of a pill-style split next to the Changes control (toolbar). */
  splitTrailing?: boolean;
  /** Left-attached when fused after a branch/worktree control. */
  attachedLeading?: boolean;
  enabled?: boolean;
  onShip: () => void;
  /**
   * When set, Ship renders as a split button: the chevron segment opens a
   * dropdown with a "Create pull request" action that opens an AI session
   * (Settings → Defaults → Create PR), mirroring how Ship itself works.
   */
  onCreatePullRequest?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; right: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLElement>(null);
  const hasMenu = !!onCreatePullRequest;

  const onClick = useCallback(() => {
    if (!enabled) return;
    onShip();
  }, [enabled, onShip]);

  // Voice control: "ship it" / "commit & push" triggers the same primary action.
  useEffect(() => {
    const onVoiceShip = () => onClick();
    window.addEventListener(VOICE_SHIP_EVENT, onVoiceShip);
    return () => window.removeEventListener(VOICE_SHIP_EVENT, onVoiceShip);
  }, [onClick]);

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuRect({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
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

  const tooltip = !enabled
    ? "Ship unavailable until the project folder is valid"
    : (title ?? "Open an AI session to push and sync with remote");

  const className = [
    splitTrailing || attachedLeading ? "mc-btn-attached-left" : null,
    hasMenu ? "mc-btn-attached-right" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const shipButton = (
    <HotkeyTooltip action="project.ship" label={tooltip}>
      <Btn
        variant={variant}
        size={size}
        icon="upload"
        className={className || undefined}
        onClick={onClick}
        disabled={!enabled}
        aria-label={tooltip}
        style={{ fontFamily: "var(--mono)" }}
      >
        {label}
      </Btn>
    </HotkeyTooltip>
  );

  if (!hasMenu) return shipButton;

  return (
    <div ref={anchorRef} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
      {shipButton}
      <Btn
        variant={variant}
        size={size}
        className="mc-btn-attached-left"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={!enabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="More ship actions"
        title="More ship actions"
        style={{ minWidth: 30, paddingInline: 0 }}
      >
        <Icon
          name="chevron-down"
          size={13}
          style={{
            flexShrink: 0,
            transform: menuOpen ? "rotate(180deg)" : undefined,
            transition: "transform 120ms ease",
          }}
        />
      </Btn>
      {menuOpen &&
        menuRect &&
        createPortal(
          <CardFrame
            ref={menuRef}
            role="menu"
            aria-label="More ship actions"
            solid
            className="mc-project-actions-menu"
            style={{
              position: "fixed",
              top: menuRect.top,
              right: menuRect.right,
              minWidth: 220,
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            <DropdownMenuItem
              icon="github"
              onClick={() => {
                setMenuOpen(false);
                onCreatePullRequest();
              }}
              title="Open an AI session to commit, push, sync, and create a pull request"
            >
              Create pull request
            </DropdownMenuItem>
          </CardFrame>,
          document.body,
        )}
    </div>
  );
}
