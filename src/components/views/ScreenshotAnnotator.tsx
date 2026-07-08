import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "~/components/ui/Icon";
import { getElectron } from "~/lib/electron";
import type { PendingScreenshot } from "~/lib/terminal-store";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

type Tool = "select" | "pen" | "highlighter" | "arrow" | "rect" | "ellipse" | "text";

type Pt = { x: number; y: number };

// Common fields are inlined on every member (rather than intersected via a
// BaseShape) so TypeScript reliably narrows the union in if/return chains.
// Exported so the pending-screenshot store can persist the editable shapes
// across a save/reopen (otherwise a re-edit only sees flattened pixels).
export type Shape =
  | { id: string; color: string; width: number; type: "pen" | "highlighter"; points: Pt[] }
  | { id: string; color: string; width: number; type: "arrow" | "rect" | "ellipse"; x1: number; y1: number; x2: number; y2: number }
  | { id: string; color: string; width: number; type: "text"; x: number; y: number; text: string; fontSize: number };

type Status = "loading" | "ready" | "error";

// Draft of a text being typed before it becomes a committed shape. `editingId`
// is set when re-editing an existing text shape (double-click in select mode).
type TextDraft = { x: number; y: number; fontSize: number; color: string; value: string; editingId: string | null };

const TOOLS: Array<{ tool: Tool; icon: IconName; label: string; key: string }> = [
  { tool: "select", icon: "cursor", label: "Select / move", key: "V" },
  { tool: "pen", icon: "pencil", label: "Pen", key: "P" },
  { tool: "highlighter", icon: "highlighter", label: "Highlighter", key: "H" },
  { tool: "arrow", icon: "arrow-up-right", label: "Arrow", key: "A" },
  { tool: "rect", icon: "square", label: "Rectangle", key: "R" },
  { tool: "ellipse", icon: "circle", label: "Ellipse", key: "O" },
  { tool: "text", icon: "text", label: "Text", key: "T" },
];

// Annotation palette — warm, saturated marker colors that read on any
// screenshot. Deliberately avoids the cyan/purple "AI" look.
const COLORS = [
  "#f5333f", // red
  "#ff8a1e", // amber
  "#ffd23f", // yellow
  "#39d353", // green
  "#3b9dff", // blue
  "#0b0f14", // ink
  "#f5f7fa", // chalk
];

// Stroke widths in image (device) pixels. Screenshots are Retina, so these are
// tuned to feel like ~thin/medium/thick marker tips on screen.
const WIDTHS = [
  { w: 6, dot: 5, label: "Thin" },
  { w: 12, dot: 8, label: "Medium" },
  { w: 20, dot: 11, label: "Thick" },
];

// Text point-sizes paired with each width step.
const TEXT_SIZES = [30, 46, 66];

let shapeSeq = 0;
function nextId(): string {
  shapeSeq += 1;
  return `s${shapeSeq}`;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

type Box = { x: number; y: number; w: number; h: number };

function shapeBox(s: Shape, ctx: CanvasRenderingContext2D): Box {
  switch (s.type) {
    case "pen":
    case "highlighter": {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      const pad = s.width;
      const minX = Math.min(...xs) - pad;
      const minY = Math.min(...ys) - pad;
      return { x: minX, y: minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + pad - minY };
    }
    case "text": {
      ctx.font = textFont(s.fontSize);
      const lines = s.text.split("\n");
      const w = Math.max(1, ...lines.map((l) => ctx.measureText(l || " ").width));
      const h = lines.length * s.fontSize * 1.25;
      return { x: s.x - 4, y: s.y - 4, w: w + 8, h: h + 8 };
    }
    case "arrow":
    case "rect":
    case "ellipse": {
      const pad = s.width;
      const minX = Math.min(s.x1, s.x2) - pad;
      const minY = Math.min(s.y1, s.y2) - pad;
      return { x: minX, y: minY, w: Math.abs(s.x2 - s.x1) + pad * 2, h: Math.abs(s.y2 - s.y1) + pad * 2 };
    }
  }
}

function boxHit(b: Box, p: Pt): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

function translate(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case "pen":
    case "highlighter":
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case "text":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "arrow":
    case "rect":
    case "ellipse":
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  }
}

function textFont(size: number): string {
  return `600 ${size}px ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif`;
}

/* ------------------------------------------------------------------ *
 * Canvas drawing
 * ------------------------------------------------------------------ */

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;

  switch (s.type) {
    case "highlighter":
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = "multiply";
      ctx.lineWidth = s.width * 2.4;
      strokePath(ctx, s.points);
      break;
    case "pen":
      strokePath(ctx, s.points);
      break;
    case "rect":
      ctx.strokeRect(
        Math.min(s.x1, s.x2),
        Math.min(s.y1, s.y2),
        Math.abs(s.x2 - s.x1),
        Math.abs(s.y2 - s.y1),
      );
      break;
    case "ellipse": {
      const cx = (s.x1 + s.x2) / 2;
      const cy = (s.y1 + s.y2) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "arrow":
      drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.width);
      break;
    case "text": {
      ctx.font = textFont(s.fontSize);
      ctx.textBaseline = "top";
      // A soft dark halo keeps light text legible over bright screenshots.
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = s.fontSize * 0.12;
      s.text.split("\n").forEach((line, i) => {
        ctx.fillText(line, s.x, s.y + i * s.fontSize * 1.25);
      });
      break;
    }
  }
  ctx.restore();
}

function strokePath(ctx: CanvasRenderingContext2D, points: Pt[]) {
  if (points.length === 0) return;
  ctx.beginPath();
  if (points.length === 1) {
    // A single tap becomes a dot.
    ctx.arc(points[0]!.x, points[0]!.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.fill();
    return;
  }
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2);
  }
  ctx.stroke();
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 0.5) return;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  // Head sized off the stroke width (with a floor so thin arrows stay
  // legible), but never longer than the arrow itself.
  const head = Math.min(Math.max(width * 3.5, 12), len);
  const spread = Math.PI / 6;
  // Stop the shaft inside the head: the round line cap would otherwise bulge
  // past the triangle's tip and edges and blunt the point.
  const shaft = len - head * 0.8;
  if (shaft > 0) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + shaft * Math.cos(angle), y1 + shaft * Math.sin(angle));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - spread), y2 - head * Math.sin(angle - spread));
  ctx.lineTo(x2 - head * Math.cos(angle + spread), y2 - head * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

// Matches SCREENSHOT_PREVIEW_WIDTH_PX in electron/main.ts so a saved
// annotation renders its thumbnail at the same size as a fresh capture.
const PREVIEW_WIDTH_PX = 320;

export function ScreenshotAnnotator({
  shot,
  onCancel,
  onAttach,
  onSave,
}: {
  shot: PendingScreenshot;
  onCancel: () => void;
  /** Called with the saved annotated PNG path; attaches to the active session. */
  onAttach: (path: string) => void;
  /** Called with the saved annotated PNG path + a downscaled preview; keeps the
   *  image as a pending thumbnail instead of attaching it. `editable` carries the
   *  un-flattened base image and vector shapes so a later re-edit is editable. */
  onSave: (
    path: string,
    previewDataUrl: string,
    editable: { originalPath: string; shapes: Shape[] },
  ) => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState<string>(COLORS[0]!);
  const [widthIdx, setWidthIdx] = useState(1);

  // Restore any shapes persisted from a prior save so re-editing keeps the old
  // annotations selectable, and bump the id counter past them so new shapes
  // can't collide with a restored id.
  const [shapes, setShapes] = useState<Shape[]>(() => {
    const initial = shot.shapes ?? [];
    for (const s of initial) {
      const n = Number(s.id.replace(/^s/u, ""));
      if (Number.isFinite(n) && n > shapeSeq) shapeSeq = n;
    }
    return initial;
  });
  const [past, setPast] = useState<Shape[][]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  // Which footer action is in flight ("save" | "attach"); both are disabled
  // while either runs so a double export can't race.
  const [busy, setBusy] = useState<"save" | "attach" | null>(null);

  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // False until the text box has actually taken focus, so the spurious blur
  // fired by the placing-click doesn't commit-and-discard the empty draft.
  const textareaReadyRef = useRef(false);

  // Per-gesture scratch, kept in a ref so pointer handlers stay identity-stable.
  const gesture = useRef<{
    startShapes: Shape[];
    mode: "draw" | "move" | "none";
    moveId: string | null;
    last: Pt;
  } | null>(null);

  /* ---- layout: fit the stage into the viewport ---- */
  const [stageBox, setStageBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  const display = useMemo(() => {
    if (!dims.w || !dims.h || !stageBox.w || !stageBox.h) return { w: 0, h: 0 };
    const scale = Math.min(stageBox.w / dims.w, stageBox.h / dims.h, 2.5);
    return { w: Math.round(dims.w * scale), h: Math.round(dims.h * scale) };
  }, [dims, stageBox]);

  // WIDTHS/TEXT_SIZES are tuned as apparent sizes for a full-screen Retina
  // capture displayed at ~0.5x. Small region captures display zoomed (up to
  // 2.5x), which would blow marks up 5x on screen — so normalize by the actual
  // display scale to keep the apparent size constant.
  const sizeScale = display.w > 0 && dims.w > 0 ? dims.w / display.w / 2 : 1;
  const strokeWidth = WIDTHS[widthIdx]!.w * sizeScale;
  const textSize = Math.round(TEXT_SIZES[widthIdx]! * sizeScale);

  /* ---- load the full-resolution image ---- */
  // Draw on the un-annotated original when re-editing, not the flattened save,
  // so persisted shapes render once (as editable shapes) instead of twice.
  const basePath = shot.originalPath ?? shot.path;
  useEffect(() => {
    let cancelled = false;
    const electron = getElectron();
    async function load() {
      let dataUrl = shot.previewDataUrl;
      if (electron) {
        const res = await electron.screenshot.readImage(basePath);
        if (!cancelled && "dataUrl" in res) dataUrl = res.dataUrl;
      }
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        imgRef.current = img;
        setDims({ w: img.naturalWidth, h: img.naturalHeight });
        setStatus("ready");
      };
      img.onerror = () => !cancelled && setStatus("error");
      img.src = dataUrl;
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [basePath, shot.previewDataUrl]);

  /* ---- redraw whenever anything visible changes ---- */
  const render = useCallback(
    (ctx: CanvasRenderingContext2D, list: Shape[], withSelection: boolean) => {
      const img = imgRef.current;
      if (!img) return;
      ctx.clearRect(0, 0, dims.w, dims.h);
      ctx.drawImage(img, 0, 0, dims.w, dims.h);
      for (const s of list) {
        if (textDraft?.editingId === s.id) continue; // hidden while re-editing
        drawShape(ctx, s);
      }
      if (draft) drawShape(ctx, draft);
      if (withSelection && selectedId) {
        const sel = list.find((s) => s.id === selectedId);
        if (sel) {
          const b = shapeBox(sel, ctx);
          ctx.save();
          ctx.setLineDash([8, 6]);
          ctx.lineWidth = Math.max(2, dims.w / 600);
          ctx.strokeStyle = "rgba(120,170,255,0.95)";
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          ctx.restore();
        }
      }
    },
    [dims.w, dims.h, draft, selectedId, textDraft],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status !== "ready") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    render(ctx, shapes, true);
  }, [render, shapes, status]);

  /* ---- coordinate mapping (client px -> image px) ---- */
  const toImage = useCallback(
    (clientX: number, clientY: number): Pt => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const r = canvas.getBoundingClientRect();
      return {
        x: ((clientX - r.left) / r.width) * dims.w,
        y: ((clientY - r.top) / r.height) * dims.h,
      };
    },
    [dims.w, dims.h],
  );

  /* ---- history ---- */
  const finalize = useCallback((next: Shape[], startShapes: Shape[]) => {
    setPast((p) => [...p, startShapes]);
    setFuture([]);
    setShapes(next);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1]!;
      setFuture((f) => [shapesRef.current, ...f]);
      setShapes(prev);
      setSelectedId(null);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0]!;
      setPast((p) => [...p, shapesRef.current]);
      setShapes(next);
      setSelectedId(null);
      return f.slice(1);
    });
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    finalize(
      shapesRef.current.filter((s) => s.id !== selectedId),
      shapesRef.current,
    );
    setSelectedId(null);
  }, [finalize, selectedId]);

  const clearAll = useCallback(() => {
    if (shapesRef.current.length === 0) return;
    finalize([], shapesRef.current);
    setSelectedId(null);
  }, [finalize]);

  /* ---- text commit ---- */
  const commitText = useCallback(() => {
    setTextDraft((d) => {
      if (!d) return null;
      const value = d.value.replace(/\s+$/u, "");
      const start = shapesRef.current;
      if (d.editingId) {
        const next = value
          ? start.map((s) =>
              s.id === d.editingId && s.type === "text" ? { ...s, text: value } : s,
            )
          : start.filter((s) => s.id !== d.editingId);
        finalize(next, start);
      } else if (value) {
        const shape: Shape = {
          id: nextId(),
          type: "text",
          x: d.x,
          y: d.y,
          text: value,
          color: d.color,
          fontSize: d.fontSize,
          width: 0,
        };
        finalize([...start, shape], start);
      }
      return null;
    });
  }, [finalize]);

  /* ---- pointer handlers ---- */
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0 || status !== "ready") return;
      if (textDraft) {
        commitText();
        return;
      }
      const p = toImage(e.clientX, e.clientY);
      const canvas = canvasRef.current!;
      const start = shapesRef.current;

      if (tool === "text") {
        // Place a text box and hand focus to the overlay input — do NOT capture
        // the pointer here, or the canvas keeps focus and typing goes nowhere.
        setSelectedId(null);
        setTextDraft({ x: p.x, y: p.y, fontSize: textSize, color, value: "", editingId: null });
        return;
      }

      canvas.setPointerCapture(e.pointerId);

      if (tool === "select") {
        const ctx = canvas.getContext("2d")!;
        let hit: Shape | null = null;
        for (let i = start.length - 1; i >= 0; i--) {
          if (boxHit(shapeBox(start[i]!, ctx), p)) {
            hit = start[i]!;
            break;
          }
        }
        setSelectedId(hit?.id ?? null);
        gesture.current = {
          startShapes: start,
          mode: hit ? "move" : "none",
          moveId: hit?.id ?? null,
          last: p,
        };
        return;
      }

      // Drawing tools: start a draft; committed on pointer up.
      setSelectedId(null);
      const base = { id: nextId(), color, width: strokeWidth };
      const newDraft: Shape =
        tool === "pen" || tool === "highlighter"
          ? { ...base, type: tool, points: [p] }
          : { ...base, type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      setDraft(newDraft);
      gesture.current = { startShapes: start, mode: "draw", moveId: null, last: p };
    },
    [color, commitText, status, strokeWidth, textDraft, textSize, tool, toImage],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const g = gesture.current;
      if (!g || g.mode === "none") return;
      const p = toImage(e.clientX, e.clientY);

      if (g.mode === "move" && g.moveId) {
        const dx = p.x - g.last.x;
        const dy = p.y - g.last.y;
        g.last = p;
        setShapes((prev) => prev.map((s) => (s.id === g.moveId ? translate(s, dx, dy) : s)));
        return;
      }

      // draw
      setDraft((d) => {
        if (!d) return d;
        if (d.type === "pen" || d.type === "highlighter") {
          return { ...d, points: [...d.points, p] };
        }
        const shift = e.shiftKey;
        let x2 = p.x;
        let y2 = p.y;
        if (shift && (d.type === "rect" || d.type === "ellipse")) {
          // Constrain to a square/circle.
          const side = Math.max(Math.abs(p.x - d.x1), Math.abs(p.y - d.y1));
          x2 = d.x1 + Math.sign(p.x - d.x1) * side;
          y2 = d.y1 + Math.sign(p.y - d.y1) * side;
        }
        return { ...d, x2, y2 };
      });
    },
    [toImage],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const g = gesture.current;
      gesture.current = null;
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!g) return;

      if (g.mode === "move") {
        // Commit the moved state to history (shapes already reflect the move).
        setPast((p) => [...p, g.startShapes]);
        setFuture([]);
        return;
      }

      if (g.mode === "draw") {
        setDraft((d) => {
          if (!d) return null;
          const tiny =
            (d.type === "rect" || d.type === "ellipse" || d.type === "arrow") &&
            Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 6 * sizeScale;
          if (!tiny) finalize([...g.startShapes, d], g.startShapes);
          return null;
        });
      }
    },
    [finalize, sizeScale],
  );

  const onDoubleClick = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (status !== "ready") return;
      const p = toImage(e.clientX, e.clientY);
      const ctx = canvasRef.current!.getContext("2d")!;
      for (let i = shapesRef.current.length - 1; i >= 0; i--) {
        const s = shapesRef.current[i]!;
        if (s.type === "text" && boxHit(shapeBox(s, ctx), p)) {
          setTextDraft({ x: s.x, y: s.y, fontSize: s.fontSize, color: s.color, value: s.text, editingId: s.id });
          setSelectedId(null);
          return;
        }
      }
    },
    [status, toImage],
  );

  /* ---- focus the textarea when a text draft opens ----
   * The click that placed the text resolves AFTER the textarea mounts, and the
   * browser then moves focus off it (the click landed on the canvas) — which
   * would fire onBlur and discard the empty draft immediately. So we (a) ignore
   * blur until the box is "ready" and (b) (re)focus on the next frame, after the
   * click's own focus handling has run. */
  useLayoutEffect(() => {
    textareaReadyRef.current = false;
    if (!textDraft) return;
    const focus = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    };
    focus(); // initial focus (may be stolen by the placing-click)
    // Re-focus on the next frame, AFTER the click's focus handling; only now
    // arm blur-to-commit so the spurious blur in between is ignored.
    const raf = requestAnimationFrame(() => {
      focus();
      textareaReadyRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [textDraft]);

  /* ---- keyboard: scoped to the editor overlay ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = !!textDraft;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (typing) setTextDraft(null);
        else onCancel();
        return;
      }
      if (typing) return; // let the textarea handle everything else
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selectedId) {
        e.preventDefault();
        e.stopPropagation();
        deleteSelected();
        return;
      }
      const hit = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (hit && !mod) {
        e.preventDefault();
        e.stopPropagation();
        setTool(hit.tool);
      }
    };
    // Capture phase so app-global hotkeys don't also fire underneath.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [deleteSelected, onCancel, redo, selectedId, textDraft, undo]);

  /* ---- export ---- */
  // Flattens the screenshot + annotations to a PNG on disk and returns its
  // path plus a downscaled preview data URL for the floating thumbnail.
  const exportPng = useCallback(async (): Promise<{ path: string; previewDataUrl: string }> => {
    const off = document.createElement("canvas");
    off.width = dims.w;
    off.height = dims.h;
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("no ctx");
    render(ctx, shapesRef.current, false);
    const blob = await new Promise<Blob | null>((res) => off.toBlob(res, "image/png"));
    if (!blob) throw new Error("encode failed");
    const electron = getElectron();
    if (!electron) throw new Error("no electron");
    const buf = await blob.arrayBuffer();
    const saved = await electron.terminalImages.saveDropped({
      name: "screenshot-annotated",
      mimeType: "image/png",
      data: buf,
    });
    if ("error" in saved) throw new Error(saved.error);

    const scale = Math.min(1, PREVIEW_WIDTH_PX / dims.w);
    const thumb = document.createElement("canvas");
    thumb.width = Math.max(1, Math.round(dims.w * scale));
    thumb.height = Math.max(1, Math.round(dims.h * scale));
    const tctx = thumb.getContext("2d");
    if (!tctx) throw new Error("no ctx");
    tctx.drawImage(off, 0, 0, thumb.width, thumb.height);
    return { path: saved.path, previewDataUrl: thumb.toDataURL("image/png") };
  }, [dims.w, dims.h, render]);

  const attach = useCallback(async () => {
    if (status !== "ready" || busy) return;
    setBusy("attach");
    try {
      const { path } = await exportPng();
      onAttach(path);
    } catch {
      setBusy(null);
    }
  }, [busy, exportPng, onAttach, status]);

  const save = useCallback(async () => {
    if (status !== "ready" || busy) return;
    setBusy("save");
    try {
      const { path, previewDataUrl } = await exportPng();
      onSave(path, previewDataUrl, { originalPath: basePath, shapes: shapesRef.current });
    } catch {
      setBusy(null);
    }
  }, [basePath, busy, exportPng, onSave, status]);

  // Recolor the currently-selected shape when a color is picked in select mode.
  const recolorSelected = useCallback(
    (c: string) => {
      if (!selectedId) return;
      finalize(
        shapesRef.current.map((s) => (s.id === selectedId ? { ...s, color: c } : s)),
        shapesRef.current,
      );
    },
    [finalize, selectedId],
  );

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const cursor = tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

  // Screen position of the live text draft (fixed coords) for the overlay input.
  const textOverlay = useMemo(() => {
    if (!textDraft || !canvasRef.current) return null;
    const r = canvasRef.current.getBoundingClientRect();
    const sx = r.width / dims.w;
    return {
      left: r.left + textDraft.x * sx,
      top: r.top + textDraft.y * (r.height / dims.h),
      fontSize: textDraft.fontSize * sx,
      color: textDraft.color,
    };
  }, [textDraft, dims.w, dims.h, display]);

  const overlay = (
    <div
      className="mc-annot-root"
      role="dialog"
      aria-modal="true"
      aria-label="Annotate screenshot"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        display: "flex",
        flexDirection: "column",
        background: "rgba(4, 7, 10, 0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <style>{ANNOT_CSS}</style>

      {/* Toolbar */}
      <div className="mc-annot-bar-wrap">
        <div className="mc-annot-bar">
          <div className="mc-annot-group">
            {TOOLS.map((t) => (
              <button
                key={t.tool}
                type="button"
                className={`mc-annot-tool${tool === t.tool ? " is-active" : ""}`}
                title={`${t.label} · ${t.key}`}
                aria-label={t.label}
                aria-pressed={tool === t.tool}
                onClick={() => setTool(t.tool)}
              >
                <Icon name={t.icon} size={16} />
              </button>
            ))}
          </div>

          <span className="mc-annot-div" />

          <div className="mc-annot-group">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`mc-annot-swatch${color === c ? " is-active" : ""}`}
                title={c}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                onClick={() => {
                  setColor(c);
                  recolorSelected(c);
                }}
                style={{ background: c }}
              />
            ))}
            <label className="mc-annot-swatch mc-annot-custom" title="Custom color">
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  recolorSelected(e.target.value);
                }}
              />
            </label>
          </div>

          <span className="mc-annot-div" />

          <div className="mc-annot-group">
            {WIDTHS.map((w, i) => (
              <button
                key={w.label}
                type="button"
                className={`mc-annot-width${widthIdx === i ? " is-active" : ""}`}
                title={w.label}
                aria-label={w.label}
                aria-pressed={widthIdx === i}
                onClick={() => setWidthIdx(i)}
              >
                <span style={{ width: w.dot, height: w.dot, borderRadius: 999, background: "currentColor" }} />
              </button>
            ))}
          </div>

          <span className="mc-annot-div" />

          <div className="mc-annot-group">
            <button
              type="button"
              className="mc-annot-tool"
              title="Undo · ⌘Z"
              aria-label="Undo"
              disabled={!canUndo}
              onClick={undo}
            >
              <Icon name="undo" size={16} />
            </button>
            <button
              type="button"
              className="mc-annot-tool"
              title="Redo · ⇧⌘Z"
              aria-label="Redo"
              disabled={!canRedo}
              onClick={redo}
            >
              <Icon name="redo" size={16} />
            </button>
            <button
              type="button"
              className="mc-annot-tool"
              title="Clear all"
              aria-label="Clear all"
              disabled={shapes.length === 0}
              onClick={clearAll}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Stage */}
      <div ref={stageRef} className="mc-annot-stage">
        {status === "loading" && <div className="mc-annot-hint">Loading screenshot…</div>}
        {status === "error" && <div className="mc-annot-hint">Couldn’t load the screenshot.</div>}
        {status === "ready" && (
          <div
            className="mc-annot-canvas-frame"
            style={{ width: display.w || undefined, height: display.h || undefined }}
          >
            <canvas
              ref={canvasRef}
              width={dims.w}
              height={dims.h}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={onDoubleClick}
              style={{
                display: "block",
                width: display.w || "100%",
                height: display.h || "auto",
                borderRadius: 10,
                cursor,
                touchAction: "none",
              }}
            />
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="mc-annot-footer">
        <div className="mc-annot-footer-hint">
          {tool === "text"
            ? "Click to place text · double-click text to edit"
            : tool === "select"
              ? "Drag to move · ⌫ to delete"
              : "Drag on the image to draw"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="mc-annot-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="mc-annot-btn" onClick={save} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="mc-annot-btn is-primary"
            onClick={attach}
            disabled={busy !== null}
          >
            {busy === "attach" ? "Attaching…" : "Attach to session"}
          </button>
        </div>
      </div>

      {/* Live text input overlay. Offsets cancel the box padding+border so the
          glyphs line up with where the committed text will draw. */}
      {textDraft && textOverlay && (
        <textarea
          ref={textareaRef}
          className="mc-annot-textarea"
          value={textDraft.value}
          placeholder="Type…"
          autoFocus
          onChange={(e) => setTextDraft((d) => (d ? { ...d, value: e.target.value } : d))}
          onBlur={() => {
            // Ignore the spurious blur from the placing-click; a real blur
            // (clicking elsewhere after typing) commits.
            if (textareaReadyRef.current) commitText();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText();
            }
          }}
          spellCheck={false}
          style={{
            left: textOverlay.left - 6,
            top: textOverlay.top - 4,
            fontSize: textOverlay.fontSize,
            color: textOverlay.color,
            lineHeight: 1.25,
          }}
        />
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}

const ANNOT_CSS = `
.mc-annot-root { animation: mc-annot-fade 140ms ease-out; }
@keyframes mc-annot-fade { from { opacity: 0; } to { opacity: 1; } }
.mc-annot-bar-wrap { display: flex; justify-content: center; padding: 16px 16px 0; }
.mc-annot-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px; border-radius: 14px;
  background: var(--surface-2); border: 1px solid var(--border);
  box-shadow: 0 10px 34px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
  animation: mc-annot-rise 200ms cubic-bezier(0.16,1,0.3,1);
}
@keyframes mc-annot-rise { from { transform: translateY(-8px); opacity: 0; } to { transform: none; opacity: 1; } }
.mc-annot-group { display: flex; align-items: center; gap: 3px; }
.mc-annot-div { width: 1px; align-self: stretch; margin: 4px 4px; background: var(--border); }
.mc-annot-tool {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; padding: 0; border-radius: 9px;
  border: 1px solid transparent; background: transparent; color: var(--text-dim);
  cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms;
}
.mc-annot-tool:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
.mc-annot-tool.is-active { background: var(--accent-faint); color: var(--accent); border-color: var(--accent-border); }
.mc-annot-tool:disabled { opacity: 0.35; cursor: default; }
.mc-annot-width {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 34px; padding: 0; border-radius: 9px;
  border: 1px solid transparent; background: transparent; color: var(--text-dim); cursor: pointer;
  transition: background 120ms, color 120ms, border-color 120ms;
}
.mc-annot-width:hover { background: var(--surface-3); color: var(--text); }
.mc-annot-width.is-active { background: var(--accent-faint); color: var(--accent); border-color: var(--accent-border); }
.mc-annot-swatch {
  position: relative; width: 22px; height: 22px; padding: 0; border-radius: 999px;
  border: 2px solid transparent; box-shadow: 0 0 0 1px rgba(0,0,0,0.35) inset; cursor: pointer;
  transition: transform 120ms; box-sizing: border-box;
}
.mc-annot-swatch:hover { transform: scale(1.12); }
.mc-annot-swatch.is-active { border-color: var(--text); box-shadow: 0 0 0 2px var(--surface-2), 0 0 0 3px var(--text); }
.mc-annot-custom { display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
  background: conic-gradient(from 0deg, #f5333f, #ffd23f, #39d353, #3b9dff, #a05bff, #f5333f); }
.mc-annot-custom input { position: absolute; inset: -6px; opacity: 0; cursor: pointer; }
.mc-annot-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 16px 24px; }
.mc-annot-canvas-frame {
  border-radius: 12px; overflow: hidden; box-shadow: 0 24px 70px rgba(0,0,0,0.55);
  animation: mc-annot-pop 220ms cubic-bezier(0.16,1,0.3,1);
}
@keyframes mc-annot-pop { from { transform: scale(0.98); opacity: 0; } to { transform: none; opacity: 1; } }
.mc-annot-hint { color: var(--text-dim); font-family: var(--mono); font-size: 12px; }
.mc-annot-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 20px 18px;
}
.mc-annot-footer-hint { color: var(--text-faint); font-family: var(--mono); font-size: 11px; letter-spacing: 0.02em; }
.mc-annot-btn {
  height: 34px; padding: 0 16px; border-radius: 9px; font-size: 13px; font-weight: 600;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text); cursor: pointer;
  transition: background 120ms, border-color 120ms, transform 80ms;
}
.mc-annot-btn:hover { background: var(--surface-3); }
.mc-annot-btn:active { transform: translateY(1px); }
.mc-annot-btn.is-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.mc-annot-btn.is-primary:hover { background: var(--accent-hover, var(--accent)); }
.mc-annot-btn:disabled { opacity: 0.6; cursor: default; }
.mc-annot-textarea {
  position: fixed; margin: 0; padding: 3px 5px; outline: none; resize: none;
  overflow: hidden; white-space: pre; min-width: 44px; min-height: 1.25em;
  border: 1.5px dashed color-mix(in srgb, var(--accent) 70%, #8cb4ff);
  border-radius: 6px; background: rgba(9, 13, 19, 0.6);
  box-shadow: 0 4px 18px rgba(0,0,0,0.45);
  font-weight: 600; font-family: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  caret-color: #8cb4ff; z-index: 10060;
  text-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.mc-annot-textarea::placeholder { color: rgba(200,215,240,0.45); font-weight: 500; }
@media (prefers-reduced-motion: reduce) {
  .mc-annot-root, .mc-annot-bar, .mc-annot-canvas-frame { animation: none; }
}
`;
