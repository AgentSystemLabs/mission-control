import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { Icon } from "~/components/ui/Icon";
import {
  ScreenshotAnnotator,
  type Shape as AnnotationShape,
  type CropBox,
} from "~/components/views/ScreenshotAnnotator";
import { SessionDropzoneHighlight } from "~/components/views/SessionDropzone";
import { useTerminals, type ScreenshotEntry } from "~/lib/terminal-store";
import { playScreenshotDrop } from "~/lib/screenshot-sound";

// Match the grid's reorder drag: only start dragging once the pointer clears a
// few pixels, so a plain click still registers as a click (open the editor).
const DRAG_THRESHOLD_PX = 6;
// Fixed thumbnail height keeps the strip a predictable height; width follows the
// image aspect ratio up to a cap so a wide capture doesn't hog the row.
const THUMB_HEIGHT_PX = 68;
// Every card renders at one fixed width so the strip reads as an even row of
// tiles regardless of each capture's native aspect ratio (the image is
// object-fit: cover, so it fills the frame and crops rather than letterboxing).
const THUMB_WIDTH_PX = 116;

// The session cell / terminal panel under a screen point, if any.
function sessionHostAtPoint(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return (el?.closest?.("[data-task-id]") as HTMLElement | null) ?? null;
}

const thumbFrameStyle: CSSProperties = {
  position: "relative",
  height: THUMB_HEIGHT_PX,
  width: THUMB_WIDTH_PX,
  borderRadius: 8,
  overflow: "hidden",
  // A soft top-lit surface so a card reads as a raised tile even before (or
  // behind) its capture — the flat single-fill looked washed out on the strip.
  // Border + resting shadow live in the .screenshot-history-card CSS so :hover
  // can recolor the border to the accent without an inline style shadowing it.
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--text) 6%, var(--surface-2)), var(--surface-2))",
  lineHeight: 0,
  flexShrink: 0,
  userSelect: "none",
  boxSizing: "border-box",
};

/**
 * One draggable screenshot in the history strip. Drag it onto any session cell
 * (grid) or the active terminal panel to attach the image to that session; a
 * plain click opens the annotation editor; the ✕ hard-deletes it. Attaching
 * keeps the screenshot in history — the strip is a persistent archive, not a
 * one-shot queue.
 */
function ScreenshotHistoryCard({
  shot,
  projectId,
}: {
  shot: ScreenshotEntry;
  projectId: string;
}) {
  const { removeScreenshot, updateScreenshot, attachImageToSession, activeTaskIdFor } =
    useTerminals();

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    rect: { x: number; y: number; w: number; h: number };
  } | null>(null);

  const remove = useCallback(() => removeScreenshot(shot.id), [removeScreenshot, shot.id]);

  // ✕ removal: slide the card out, then drop it from the store on animationend.
  // Reduced-motion users skip straight to removal.
  const beginLeave = useCallback(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      remove();
      return;
    }
    setLeaving(true);
  }, [remove]);

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
  // this the ghost card and dropzone overlay stay stuck on screen. Idempotent,
  // so it's safe as a `lostpointercapture` catch-all too.
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
        // Dropped on empty space: no-op, the screenshot stays in history.
        if (!taskId) return;
        void attachImageToSession(taskId, shot.path);
        playScreenshotDrop();
        // No removal — history persists after attaching.
        return;
      }

      // Plain click: open the annotation editor.
      setEditing(true);
    },
    [attachImageToSession, shot.path],
  );

  // Attach the (possibly annotated) image to the active session from the editor.
  // Keeps the screenshot in history.
  const attachToActive = useCallback(
    (imagePath: string) => {
      const active = activeTaskIdFor(projectId);
      setEditing(false);
      if (!active) return;
      void attachImageToSession(active, imagePath);
      playScreenshotDrop();
    },
    [activeTaskIdFor, attachImageToSession, projectId],
  );

  // Save (without attaching): swap this entry's image for the annotated one, so
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

  const dragging = dragPoint !== null;

  // Shared thumbnail visuals so the anchored card and the drag ghost match.
  const thumb = (ghost: boolean) =>
    shot.previewDataUrl ? (
      <img
        src={shot.previewDataUrl}
        alt={ghost ? "" : "Screenshot preview"}
        aria-hidden={ghost || undefined}
        draggable={false}
        style={{
          display: "block",
          height: THUMB_HEIGHT_PX,
          width: THUMB_WIDTH_PX,
          objectFit: "cover",
          objectPosition: "center",
        }}
      />
    ) : (
      // Restored-from-disk entry whose preview hasn't loaded yet.
      <div style={{ width: THUMB_WIDTH_PX, height: THUMB_HEIGHT_PX }} aria-hidden />
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
        className={`screenshot-history-card ${leaving ? "screenshot-card-leave" : "screenshot-card-enter"}`}
        role="button"
        tabIndex={0}
        aria-label="Click to edit the screenshot, or drag onto a session to attach"
        title="Click to edit · drag to attach"
        onPointerDown={leaving ? undefined : onPointerDown}
        onPointerMove={leaving ? undefined : onPointerMove}
        onPointerUp={leaving ? undefined : onPointerUp}
        onPointerCancel={leaving ? undefined : abortDrag}
        onLostPointerCapture={leaving ? undefined : abortDrag}
        onAnimationEnd={leaving ? remove : undefined}
        style={{
          ...thumbFrameStyle,
          cursor: dragging ? "grabbing" : "grab",
          opacity: dragging ? 0.35 : 1,
          // Pointer capture still routes move/up here while dragging, so drop
          // this out of hit-testing to expose the session under the cursor.
          // Also lock out interaction while the card is sliding away.
          pointerEvents: dragging || leaving ? "none" : "auto",
        }}
      >
        {thumb(false)}
        <button
          type="button"
          className="screenshot-strip-delete"
          aria-label="Delete screenshot"
          title="Delete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={beginLeave}
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            padding: 0,
            borderRadius: 5,
            border: "none",
            cursor: "pointer",
            color: "#fff",
            background: "rgba(0,0,0,0.55)",
          }}
        >
          <Icon name="x" size={11} />
        </button>
      </div>

      {/* Dropzone highlight over the session currently under the cursor. */}
      {dragging && dropTarget && <SessionDropzoneHighlight rect={dropTarget.rect} />}

      {dragging && dragPoint && (
        <div
          aria-hidden
          style={{
            ...thumbFrameStyle,
            position: "fixed",
            left: dragPoint.x,
            top: dragPoint.y,
            transform: "translate(-50%, -50%)",
            border: "1px solid var(--accent)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            pointerEvents: "none",
            zIndex: 10001,
          }}
        >
          {thumb(true)}
        </div>
      )}
    </>
  );
}

/**
 * Screenshot history for a project, rendered as the body of the "Project
 * Terminals" panel's Screenshots tab: a single-row horizontal slider of every
 * screenshot captured here (newest first) — never wrapped onto multiple lines.
 * Drag a thumbnail onto a session to attach it, click to edit, or ✕ to
 * permanently delete it (from history and disk). The panel supplies its own
 * header/tab chrome; this is just the slider.
 */
export function ScreenshotHistoryContent({ projectId }: { projectId: string }) {
  const { screenshots } = useTerminals();

  // Newest first. The store keeps history oldest-first; reverse for display.
  const shots = useMemo(
    () =>
      screenshots
        .filter((s) => s.projectId === projectId)
        .slice()
        .sort((a, b) => b.capturedAt - a.capturedAt),
    [screenshots, projectId],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Wheel over the slider scrolls it horizontally (mice have only a vertical
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

  // Keep the newest (leftmost) capture in view when one arrives.
  const newestId = shots[0]?.id ?? null;
  const lastNewestRef = useRef<string | null>(newestId);
  useEffect(() => {
    if (newestId && newestId !== lastNewestRef.current) {
      scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
    }
    lastNewestRef.current = newestId;
  }, [newestId]);

  if (shots.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--text-dim)",
          fontFamily: "var(--mono)",
          fontSize: 12,
        }}
      >
        <Icon name="camera" size={14} style={{ color: "var(--text-faint)" }} />
        No screenshots yet
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-screenshot-history
      aria-label="Screenshot history"
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        // Single row: never wrap onto multiple lines — scroll horizontally.
        flexWrap: "nowrap",
        gap: 8,
        padding: 8,
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      {shots.map((shot) => (
        <ScreenshotHistoryCard key={shot.id} shot={shot} projectId={projectId} />
      ))}
    </div>
  );
}
