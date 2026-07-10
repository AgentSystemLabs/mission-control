import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "~/components/ui/Icon";
import {
  ScreenshotAnnotator,
  type Shape as AnnotationShape,
  type CropBox,
} from "~/components/views/ScreenshotAnnotator";
import { useTerminals, type PendingScreenshot } from "~/lib/terminal-store";
import { playScreenshotDrop } from "~/lib/screenshot-sound";

// Match the grid's reorder drag: only start dragging once the pointer clears a
// few pixels, so a plain click still registers as a click (attach-to-active).
const DRAG_THRESHOLD_PX = 6;
const THUMB_WIDTH_PX = 168;
// Every thumbnail renders at this exact height so the stack reads as a uniform
// pile regardless of each capture's aspect ratio. Images are cropped
// (top-anchored, objectFit: cover) to fill the box.
const THUMB_HEIGHT_PX = 120;
// Compact cards for the focus-mode floating window, where the full-size stack
// would cover most of the (small) terminal.
const COMPACT_THUMB_WIDTH_PX = 116;
const COMPACT_THUMB_HEIGHT_PX = 82;

const cardBaseStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 6,
  padding: 8,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface-1)",
  // Base shadow lives in the .screenshot-stack-card class so :hover can lift it;
  // the drag ghost sets its own inline shadow.
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
function ScreenshotStackCard({
  shot,
  projectId,
  compact = false,
}: {
  shot: PendingScreenshot;
  projectId: string;
  compact?: boolean;
}) {
  const { dismissPendingScreenshot, updateScreenshot, attachImageToSession, activeTaskIdFor } =
    useTerminals();

  const thumbWidth = compact ? COMPACT_THUMB_WIDTH_PX : THUMB_WIDTH_PX;
  const thumbHeight = compact ? COMPACT_THUMB_HEIGHT_PX : THUMB_HEIGHT_PX;
  const cardStyle: CSSProperties = { ...cardBaseStyle, width: thumbWidth + 16 };

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  // Play the slide-out before the card is actually pulled from the store.
  const [leaving, setLeaving] = useState(false);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  // The session the pointer is currently over: its taskId (drop target) plus
  // screen rect (dropzone highlight). Recomputed on every move while dragging.
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    rect: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // Drop from the floating stack only — the shot stays in the history strip so
  // the user can return to it. Hard delete lives in the history strip's ✕.
  const dismiss = useCallback(
    () => dismissPendingScreenshot(shot.id),
    [dismissPendingScreenshot, shot.id],
  );

  // ✕ removal: slide the card out, then drop it from the store on animationend.
  // Reduced-motion users skip straight to removal.
  const beginLeave = useCallback(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      dismiss();
      return;
    }
    setLeaving(true);
  }, [dismiss]);

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

  // Tear down an in-flight drag without attaching. Chromium fires
  // `pointercancel` (not `pointerup`) when it interrupts the gesture — window
  // blur, the OS hijacking the pointer, a native drag starting — and without
  // this the ghost card and "Drop to attach" overlay stay stuck on screen.
  // Idempotent, so it's safe as a `lostpointercapture` catch-all too.
  const abortDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!startRef.current && !draggingRef.current) return;
    startRef.current = null;
    draggingRef.current = false;
    setDragPoint(null);
    setDropTarget(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
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

      // Plain click: open the annotation editor.
      setEditing(true);
    },
    [attachImageToSession, dismiss, shot.path],
  );

  // Attach the (possibly annotated) image to the active session, mirroring the
  // old click-to-attach behaviour once the editor closes.
  const attachToActive = useCallback(
    (imagePath: string) => {
      const active = activeTaskIdFor(projectId);
      setEditing(false);
      if (!active) {
        dismiss();
        return;
      }
      void attachImageToSession(active, imagePath);
      playScreenshotDrop();
      dismiss();
    },
    [activeTaskIdFor, attachImageToSession, dismiss, projectId],
  );

  // Save (without attaching): swap this card's image for the annotated one, so
  // the thumbnail shows the edits and a later click/drag uses the edited file.
  // Also persist the original base image + vector shapes so re-editing restores
  // the previously-added annotations as editable shapes.
  const saveEdits = useCallback(
    (
      imagePath: string,
      previewDataUrl: string,
      editable: { originalPath: string; shapes: AnnotationShape[]; crop: CropBox | null },
    ) => {
      updateScreenshot(shot.id, {
        path: imagePath,
        previewDataUrl,
        originalPath: editable.originalPath,
        shapes: editable.shapes,
        crop: editable.crop ?? undefined,
      });
      setEditing(false);
    },
    [shot.id, updateScreenshot],
  );

  // Attach button: push this card's (possibly annotated) image straight to the
  // currently active session — the no-drag path for the same "drop to attach"
  // gesture. Stop the pointer/click from bubbling so it never starts a drag or
  // opens the editor. No active session? Do nothing and keep the card around.
  const onAttachClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
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
            className="screenshot-stack-img"
            src={shot.previewDataUrl}
            alt={ghost ? "" : "Screenshot preview"}
            aria-hidden={ghost || undefined}
            draggable={false}
            style={{
              display: "block",
              width: "100%",
              height: thumbHeight,
              objectFit: "cover",
              objectPosition: "top",
            }}
          />
        </div>
        {!ghost && (
          <button
            type="button"
            className="screenshot-stack-dismiss"
            aria-label="Dismiss screenshot"
            title="Dismiss"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={beginLeave}
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: compact ? 22 : 28,
              height: compact ? 22 : 28,
              padding: 0,
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              color: "#fff",
              background: "rgba(0,0,0,0.6)",
            }}
          >
            <Icon name="x" size={compact ? 13 : 16} />
          </button>
        )}
        {!ghost && (
          <button
            type="button"
            className="screenshot-stack-attach"
            aria-label="Attach to active session"
            title="Attach to active session"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onAttachClick}
            style={{
              position: "absolute",
              bottom: 6,
              right: 6,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: compact ? 22 : 26,
              height: compact ? 22 : 26,
              padding: 0,
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              color: "#fff",
              background: "var(--accent)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          >
            <Icon name="plus" size={compact ? 13 : 15} />
          </button>
        )}
      </div>
      {/* The caption doesn't fit the compact card; its aria-label carries the
          same instructions there. */}
      {!compact && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            textAlign: "center",
            fontFamily: "var(--mono)",
          }}
        >
          Click to edit · drag to attach
        </div>
      )}
    </>
  );

  return (
    <>
      {editing && (
        <ScreenshotAnnotator
          shot={shot}
          onCancel={() => setEditing(false)}
          onAttach={attachToActive}
          onSave={saveEdits}
        />
      )}
      {/* Anchored card: holds the pointer capture; hidden (but kept mounted, so
          it keeps receiving move/up events) while the ghost is lifted. */}
      <div
        className={`screenshot-stack-card ${leaving ? "screenshot-card-leave" : "screenshot-card-enter"}`}
        role="button"
        tabIndex={0}
        aria-label="Click to edit the screenshot, or drag onto a session to attach"
        onPointerDown={leaving ? undefined : onPointerDown}
        onPointerMove={leaving ? undefined : onPointerMove}
        onPointerUp={leaving ? undefined : onPointerUp}
        onPointerCancel={leaving ? undefined : abortDrag}
        onLostPointerCapture={leaving ? undefined : abortDrag}
        onAnimationEnd={leaving ? dismiss : undefined}
        style={{
          ...cardStyle,
          cursor: dragging ? "grabbing" : "grab",
          opacity: dragging ? 0 : 1,
          // Pointer capture still routes move/up here while dragging, so drop
          // this out of hit-testing to expose the session under the corner.
          // Also lock out interaction while the card is sliding away.
          pointerEvents: dragging || leaving ? "none" : "auto",
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
            ...cardStyle,
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
 * Floating stack of freshly captured screenshots. Each new capture piles on
 * top; attaching or dismissing a card only removes it from this stack — the
 * screenshot lives on in the on-demand history strip.
 *
 * The default "floating" variant pins bottom-right, rendered globally via a
 * portal so it floats above the grid and drops can hit-test the whole document.
 * The "focus" variant is for the focus-mode floating window: compact cards
 * anchored top-right *inside* the (relatively positioned) terminal wrapper, so
 * they overlay old scrollback instead of the prompt and latest output at the
 * bottom, and always sit below the header/session bar whatever their height.
 */
export function ScreenshotThumbnail({
  projectId,
  variant = "floating",
}: {
  // The current-project id, used as the attach target for the plain-click /
  // attach-button path. Null when the user is on no project route (the global
  // floating stack still renders — drag-to-attach and per-card origin fallback
  // keep working). The focus variant always receives a concrete project id.
  projectId: string | null;
  variant?: "floating" | "focus";
}) {
  const { pendingScreenshots } = useTerminals();
  // The focus window is a single-project surface, so it only shows that
  // project's shots. The global floating stack follows the user across
  // projects — show the whole pile so a capture in one project can be dragged
  // onto (or attached from) a session in another.
  const shots =
    variant === "focus"
      ? pendingScreenshots.filter((s) => s.projectId === projectId)
      : pendingScreenshots;

  if (shots.length === 0) return null;

  if (variant === "focus") {
    return (
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 100,
          display: "flex",
          // Top-pinned: newest first, so the freshest capture hugs the corner
          // and older ones trail downward.
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          // Let clicks fall through the gaps between cards; each card
          // re-enables pointer events for itself.
          pointerEvents: "none",
        }}
      >
        {[...shots].reverse().map((shot) => (
          <ScreenshotStackCard
            key={shot.id}
            shot={shot}
            projectId={projectId ?? shot.projectId}
            compact
          />
        ))}
      </div>
    );
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        right: 16,
        // Sit clear of the docked terminal panel's bottom toolbar so the stack
        // doesn't cover the screenshots-history and panel-toggle controls.
        bottom: 64,
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
      {shots.map((shot) => (
        <ScreenshotStackCard key={shot.id} shot={shot} projectId={projectId ?? shot.projectId} />
      ))}
    </div>,
    document.body,
  );
}
