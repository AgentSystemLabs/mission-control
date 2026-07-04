import { useEffect, useRef, type CSSProperties } from "react";
import { StatusDot } from "~/components/ui/StatusDot";
import { STATUS_META } from "~/lib/design-meta";
import type { OpenTerminal } from "~/lib/terminal-store";

// Compact horizontal tab strip that lives directly below the Focus Mode header.
// One tab per open session; clicking one swaps the focused session in place
// (the floating window is never recreated). The strip collapses via the header
// menu button, scrolls horizontally when it overflows, and keeps the active tab
// in view. Session order is decided upstream (smart activity ordering) — this
// component only renders it.

/** Fixed content height so the collapse animation has a known target. */
export const FOCUS_BAR_HEIGHT = 40;
const TAB_MAX_WIDTH = 156;
const TAB_MIN_WIDTH = 96;

export function FocusSessionBar({
  open,
  sessions,
  activeTaskId,
  unread,
  onSelect,
}: {
  open: boolean;
  sessions: OpenTerminal[];
  activeTaskId: string;
  unread: Set<string>;
  onSelect: (taskId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Wheel over the strip scrolls it horizontally (mice have only a vertical
  // wheel; trackpads already emit horizontal deltas which we leave alone).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active tab visible after a switch or a reorder that moved it.
  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTaskId, open, sessions]);

  return (
    <div
      style={{
        maxHeight: open ? FOCUS_BAR_HEIGHT : 0,
        opacity: open ? 1 : 0,
        overflow: "hidden",
        flexShrink: 0,
        borderBottom: open ? "1px solid var(--border)" : "none",
        background: "var(--surface-1)",
        transition: "max-height 180ms ease, opacity 140ms ease",
      }}
      aria-hidden={!open}
    >
      <div
        ref={scrollRef}
        className="mc-focus-tabs"
        role="tablist"
        aria-label="Open sessions"
        style={{
          height: FOCUS_BAR_HEIGHT,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 6px",
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {sessions.map((session) => (
          <FocusSessionTab
            key={session.taskId}
            ref={session.taskId === activeTaskId ? activeRef : undefined}
            session={session}
            active={session.taskId === activeTaskId}
            unread={unread.has(session.taskId)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function FocusSessionTab({
  ref,
  session,
  active,
  unread,
  onSelect,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  session: OpenTerminal;
  active: boolean;
  unread: boolean;
  onSelect: (taskId: string) => void;
}) {
  const status = session.task.status;
  const title = session.task.title || "Session";
  const meta = STATUS_META[status];
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active}
      title={title}
      onClick={() => onSelect(session.taskId)}
      style={
        {
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          flexShrink: 0,
          maxWidth: TAB_MAX_WIDTH,
          minWidth: TAB_MIN_WIDTH,
          padding: "0 9px",
          borderRadius: 7,
          border: `1px solid ${active ? "var(--accent-border)" : "var(--border)"}`,
          background: active ? "var(--accent-faint)" : "var(--surface-2)",
          color: active ? "var(--text)" : "var(--text-dim)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
          position: "relative",
          transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
        } as CSSProperties
      }
    >
      <StatusDot status={status} />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      {/* Unread/update badge — a small pulsing dot for a background session that
          changed while it wasn't the one on screen. Never shown on the active
          tab (it's already in view). */}
      {unread && !active && (
        <span
          aria-label="Updated"
          style={{
            marginLeft: "auto",
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: meta?.color ?? "var(--accent)",
            boxShadow: `0 0 6px ${meta?.color ?? "var(--accent)"}`,
            animation: "pulse-dot 1.6s ease-in-out infinite",
          }}
        />
      )}
    </button>
  );
}
