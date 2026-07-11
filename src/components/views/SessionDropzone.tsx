import { useEffect, useState } from "react";
import { getElectron } from "~/lib/electron";
import { playScreenshotDrop } from "~/lib/screenshot-sound";
import {
  TERMINAL_DROP_MAX_FILES,
  resolveTerminalDropPath,
} from "~/lib/terminal-pane-helpers";
import { useTerminalActions } from "~/lib/terminal-store";

export type DropzoneRect = { x: number; y: number; w: number; h: number };

/**
 * Accent highlight + "Drop to attach" pill over the session host under a drag.
 * Shared by the screenshot cards' pointer-drags (stack + history strip) and the
 * native file drag from outside the app, so every drag-to-attach flow reads
 * identically.
 */
export function SessionDropzoneHighlight({ rect }: { rect: DropzoneRect }) {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
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
  );
}

/** The `[data-task-id]` session host the drag event is over, if any. */
function sessionHostFromDragEvent(e: DragEvent): HTMLElement | null {
  const el = e.target as HTMLElement | null;
  return (el?.closest?.("[data-task-id]") as HTMLElement | null) ?? null;
}

function isFileDrag(e: DragEvent): boolean {
  return !!e.dataTransfer?.types.includes("Files");
}

/**
 * Native-drag counterpart of the screenshot cards' drop flow: while a file
 * dragged from outside the app (Finder, a browser, …) hovers a session host —
 * grid cell, single-view terminal panel, or the focus-view terminal — show the
 * same dropzone highlight the screenshot drags show, and accept the drop
 * anywhere on that host.
 *
 * The terminal panes already accept drops over their xterm surface
 * (wireTerminalFileDrop, plain path-paste); those drops arrive here already
 * defaultPrevented and are left alone. Drops on the rest of the host (header,
 * chrome) attach via attachImageToSession — the same path screenshot drops
 * take, so images land as clipboard pastes and the session activates. Mounted
 * once in the Shell; listeners are window-level and idle until a file drag
 * actually hovers a session.
 */
export function SessionFileDropZone() {
  const { attachImageToSession } = useTerminalActions();
  const [target, setTarget] = useState<{ taskId: string; rect: DropzoneRect } | null>(null);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      const host = sessionHostFromDragEvent(e);
      const taskId = host?.getAttribute("data-task-id");
      if (!host || !taskId) {
        setTarget(null);
        return;
      }
      // Make the whole host a valid drop target — the pane's own wiring only
      // preventDefaults over its xterm surface.
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
      const r = host.getBoundingClientRect();
      // dragover fires continuously; only re-render when the target changes.
      setTarget((prev) =>
        prev &&
        prev.taskId === taskId &&
        prev.rect.x === r.left &&
        prev.rect.y === r.top &&
        prev.rect.w === r.width &&
        prev.rect.h === r.height
          ? prev
          : { taskId, rect: { x: r.left, y: r.top, w: r.width, h: r.height } },
      );
    };

    const onDrop = (e: DragEvent) => {
      setTarget(null);
      if (!isFileDrag(e)) return;
      // Landed on an xterm surface: wireTerminalFileDrop already pasted it.
      if (e.defaultPrevented) return;
      const taskId = sessionHostFromDragEvent(e)?.getAttribute("data-task-id");
      if (!taskId) return;
      e.preventDefault();
      const electron = getElectron();
      if (!electron) return;
      const files = Array.from(e.dataTransfer?.files ?? []).slice(0, TERMINAL_DROP_MAX_FILES);
      if (!files.length) return;
      void (async () => {
        let attached = false;
        // Sequential: image attaches paste through the clipboard, so parallel
        // attaches would race each other's clipboard contents.
        for (const file of files) {
          const path = await resolveTerminalDropPath(electron, file);
          if (!path) continue;
          await attachImageToSession(taskId, path);
          attached = true;
        }
        if (attached) playScreenshotDrop();
      })();
    };

    // relatedTarget is null when the drag leaves the window; in-window
    // dragleaves between elements carry the element being entered.
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setTarget(null);
    };
    const onDragEnd = () => setTarget(null);

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, [attachImageToSession]);

  if (!target) return null;
  return <SessionDropzoneHighlight rect={target.rect} />;
}
