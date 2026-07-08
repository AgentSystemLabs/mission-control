import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "~/components/ui/Icon";
import { useTerminals, type PendingScreenshot } from "~/lib/terminal-store";
import { playScreenshotDrop } from "~/lib/screenshot-sound";

// Match the grid's reorder drag: only start dragging once the pointer clears a
// few pixels, so a plain click still registers as a click (attach-to-active).
const DRAG_THRESHOLD_PX = 6;
const THUMB_WIDTH_PX = 168;

const cardBaseStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 6,
  padding: 8,
  width: THUMB_WIDTH_PX + 16,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface-1)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
  userSelect: "none",
  boxSizing: "border-box",
};

// The session cell / terminal panel under a screen point, if any.
function sessionHostAtPoint(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return (el?.closest?.("[data-task-id]") as HTMLElement | null) ?? null;
}

/**
 * One draggable thumbnail in the screenshot stack. Drag it onto any session
 * cell (grid) or the active terminal panel (single view) to attach the image to
 * that session; a plain click attaches it to the currently active session.
 * Dismiss with the ✕. Each card owns its own drag state so cards in the stack
 * move independently.
 */
function ScreenshotStackCard({ shot, projectId }: { shot: PendingScreenshot; projectId: string }) {
  const { clearPendingScreenshot, attachImageToSession, activeTaskIdFor } = useTerminals();

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  // The session the pointer is currently over: its taskId (drop target) plus
  // screen rect (dropzone highlight). Recomputed on every move while dragging.
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    rect: { x: number; y: number; w: number; h: number };
  } | null>(null);

  const dismiss = useCallback(
    () => clearPendingScreenshot(shot.id),
    [clearPendingScreenshot, shot.id],
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    if (!draggingRef.current) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
    }
    setDragPoint({ x: e.clientX, y: e.clientY });
    const host = sessionHostAtPoint(e.clientX, e.clientY);
    const taskId = host?.getAttribute("data-task-id");
    if (!host || !taskId) {
      setDropTarget(null);
      return;
    }
    const r = host.getBoundingClientRect();
    setDropTarget({ taskId, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      const wasDragging = draggingRef.current;
      startRef.current = null;
      draggingRef.current = false;
      setDragPoint(null);
      setDropTarget(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      if (!start) return;

      if (wasDragging) {
        const taskId = sessionHostAtPoint(e.clientX, e.clientY)?.getAttribute("data-task-id");
        // Dropped on empty space: keep the thumbnail for another try.
        if (!taskId) return;
        void attachImageToSession(taskId, shot.path);
        playScreenshotDrop();
        dismiss();
        return;
      }

      // Plain click: attach to whatever session is currently active.
      const active = activeTaskIdFor(projectId);
      if (!active) return;
      void attachImageToSession(active, shot.path);
      playScreenshotDrop();
      dismiss();
    },
    [activeTaskIdFor, attachImageToSession, dismiss, projectId, shot.path],
  );

  const dragging = dragPoint !== null;

  // Shared card visuals so the anchored card and the drag ghost are identical —
  // the ghost is what makes the *whole card* appear to lift and follow the
  // cursor, not just the image.
  const cardContent = (ghost: boolean) => (
    <>
      <div style={{ position: "relative" }}>
        <div style={{ borderRadius: 8, overflow: "hidden", lineHeight: 0 }}>
          <img
            src={shot.previewDataUrl}
            alt={ghost ? "" : "Screenshot preview"}
            aria-hidden={ghost || undefined}
            draggable={false}
            style={{ display: "block", width: "100%", height: "auto" }}
          />
        </div>
        {!ghost && (
          <button
            type="button"
            aria-label="Dismiss screenshot"
            title="Dismiss"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={dismiss}
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              padding: 0,
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              color: "#fff",
              background: "rgba(0,0,0,0.55)",
            }}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          textAlign: "center",
          fontFamily: "var(--mono)",
        }}
      >
        Drag onto a session
      </div>
    </>
  );

  return (
    <>
      {/* Anchored card: holds the pointer capture; hidden (but kept mounted, so
          it keeps receiving move/up events) while the ghost is lifted. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drag onto a session to attach, or click to attach to the active session"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          ...cardBaseStyle,
          cursor: dragging ? "grabbing" : "grab",
          opacity: dragging ? 0 : 1,
          // Pointer capture still routes move/up here while dragging, so drop
          // this out of hit-testing to expose the session under the corner.
          pointerEvents: dragging ? "none" : "auto",
        }}
      >
        {cardContent(false)}
      </div>

      {/* Dropzone highlight over the session currently under the cursor. */}
      {dragging && dropTarget && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: dropTarget.rect.x,
            top: dropTarget.rect.y,
            width: dropTarget.rect.w,
            height: dropTarget.rect.h,
            border: "2px solid var(--accent)",
            background: "color-mix(in srgb, var(--accent) 14%, transparent)",
            borderRadius: 10,
            boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent)",
            pointerEvents: "none",
            boxSizing: "border-box",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 8,
              transform: "translateX(-50%)",
              padding: "3px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontFamily: "var(--mono)",
              color: "#fff",
              background: "var(--accent)",
              whiteSpace: "nowrap",
            }}
          >
            Drop to attach
          </div>
        </div>
      )}

      {dragging && dragPoint && (
        <div
          aria-hidden
          style={{
            ...cardBaseStyle,
            position: "fixed",
            left: dragPoint.x,
            top: dragPoint.y,
            transform: "translate(-50%, -50%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            pointerEvents: "none",
            zIndex: 10001,
          }}
        >
          {cardContent(true)}
        </div>
      )}
    </>
  );
}

/**
 * Floating stack of captured-but-undropped screenshots, pinned bottom-right.
 * Each new capture piles on top; the oldest sits at the bottom of the stack.
 * Rendered globally via a portal so it floats above the grid and drops can
 * hit-test the whole document.
 */
export function ScreenshotThumbnail({ projectId }: { projectId: string }) {
  const { pendingScreenshots } = useTerminals();

  if (pendingScreenshots.length === 0) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 10000,
        display: "flex",
        // Newest on top, oldest at the bottom of the pile. The stack is pinned
        // at the bottom edge, so it grows upward as captures accumulate.
        flexDirection: "column-reverse",
        alignItems: "flex-end",
        gap: 8,
        // Let clicks fall through the gaps between cards; each card re-enables
        // pointer events for itself.
        pointerEvents: "none",
      }}
    >
      {pendingScreenshots.map((shot) => (
        <ScreenshotStackCard key={shot.id} shot={shot} projectId={projectId} />
      ))}
    </div>,
    document.body,
  );
}
