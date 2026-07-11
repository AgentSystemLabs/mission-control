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

type Tool = "select" | "crop" | "pen" | "highlighter" | "arrow" | "rect" | "ellipse" | "text";

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
  { tool: "crop", icon: "crop", label: "Crop", key: "C" },
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

// Human names for each swatch, shown in the hover tooltip.
const COLOR_LABELS = ["Red", "Amber", "Yellow", "Green", "Blue", "Ink", "Chalk"];

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

// A crop window into the original image, in image px. Exported so the pending-
// screenshot store and its callers can persist/restore it across a re-edit.
export type CropBox = Box;

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

// Smallest crop the user can frame, in image px, so a stray click can't collapse
// the selection to nothing.
const CROP_MIN = 24;

// Clamp a crop box inside the image and round to whole pixels (the exported
// canvas is integer-sized).
function clampCrop(b: Box, imgW: number, imgH: number): Box {
  const w = Math.min(Math.max(CROP_MIN, Math.round(b.w)), imgW);
  const h = Math.min(Math.max(CROP_MIN, Math.round(b.h)), imgH);
  const x = Math.min(Math.max(0, Math.round(b.x)), imgW - w);
  const y = Math.min(Math.max(0, Math.round(b.y)), imgH - h);
  return { x, y, w, h };
}

// Resize a crop box by dragging one handle (nx,ny in {0,0.5,1}); the opposite
// edge(s) stay put. Edges enforce CROP_MIN and never leave the image.
function resizeCrop(b: Box, nx: number, ny: number, p: Pt, imgW: number, imgH: number): Box {
  let { x, y, w, h } = b;
  if (nx === 0) {
    const right = x + w;
    x = Math.min(Math.max(0, p.x), right - CROP_MIN);
    w = right - x;
  } else if (nx === 1) {
    w = Math.min(Math.max(CROP_MIN, p.x - x), imgW - x);
  }
  if (ny === 0) {
    const bottom = y + h;
    y = Math.min(Math.max(0, p.y), bottom - CROP_MIN);
    h = bottom - y;
  } else if (ny === 1) {
    h = Math.min(Math.max(CROP_MIN, p.y - y), imgH - y);
  }
  return { x, y, w, h };
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
 * Resize handles
 * ------------------------------------------------------------------ */

// Grab radius (on-screen px) and half-size of the drawn handle squares.
const HANDLE_HIT = 9;
const HANDLE_HALF = 4;

// Handle anchors, box-relative in {0, 0.5, 1}; the center is excluded. Corners
// scale both axes; edge midpoints scale a single axis.
const HANDLE_POS: Array<{ nx: number; ny: number }> = [
  { nx: 0, ny: 0 }, { nx: 0.5, ny: 0 }, { nx: 1, ny: 0 },
  { nx: 0, ny: 0.5 }, { nx: 1, ny: 0.5 },
  { nx: 0, ny: 1 }, { nx: 0.5, ny: 1 }, { nx: 1, ny: 1 },
];

// Text has no independent width (only a font size), so it exposes corner
// handles for uniform scaling and skips the single-axis edge handles.
function handlesFor(s: Shape, b: Box): Array<{ nx: number; ny: number; x: number; y: number }> {
  const pos = s.type === "text" ? HANDLE_POS.filter((h) => h.nx !== 0.5 && h.ny !== 0.5) : HANDLE_POS;
  return pos.map((h) => ({ nx: h.nx, ny: h.ny, x: b.x + h.nx * b.w, y: b.y + h.ny * b.h }));
}

function resizeCursor(nx: number, ny: number): string {
  if (nx === 0.5) return "ns-resize";
  if (ny === 0.5) return "ew-resize";
  const nwse = (nx === 0 && ny === 0) || (nx === 1 && ny === 1);
  return nwse ? "nwse-resize" : "nesw-resize";
}

// Scale a shape about the fixed anchor (ax,ay) by (sx,sy). Geometry points move;
// stroke widths stay constant (matching most editors), while text tracks the
// dominant scale factor so glyphs grow/shrink without stretching.
function scaleShape(s: Shape, ax: number, ay: number, sx: number, sy: number): Shape {
  const sp = (x: number, y: number): Pt => ({ x: ax + (x - ax) * sx, y: ay + (y - ay) * sy });
  switch (s.type) {
    case "pen":
    case "highlighter":
      return { ...s, points: s.points.map((p) => sp(p.x, p.y)) };
    case "text": {
      const np = sp(s.x, s.y);
      const f = Math.max(8, s.fontSize * Math.max(Math.abs(sx), Math.abs(sy)));
      return { ...s, x: np.x, y: np.y, fontSize: f };
    }
    case "arrow":
    case "rect":
    case "ellipse": {
      const p1 = sp(s.x1, s.y1);
      const p2 = sp(s.x2, s.y2);
      return { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
  }
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

// Crop selection: dim everything outside the frame, draw a bright border with
// rule-of-thirds guides, and corner/edge grab handles. All in image px; `px` is
// the image→screen scale so lines stay a crisp hairline at any zoom.
function drawCropOverlay(ctx: CanvasRenderingContext2D, box: Box, imgW: number, imgH: number, px: number) {
  ctx.save();
  // Four rects masking the area outside the crop.
  ctx.fillStyle = "rgba(4, 7, 10, 0.6)";
  ctx.fillRect(0, 0, imgW, box.y);
  ctx.fillRect(0, box.y + box.h, imgW, imgH - (box.y + box.h));
  ctx.fillRect(0, box.y, box.x, box.h);
  ctx.fillRect(box.x + box.w, box.y, imgW - (box.x + box.w), box.h);

  // Rule-of-thirds guides.
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1 * px;
  ctx.beginPath();
  for (let i = 1; i < 3; i++) {
    const gx = box.x + (box.w * i) / 3;
    const gy = box.y + (box.h * i) / 3;
    ctx.moveTo(gx, box.y);
    ctx.lineTo(gx, box.y + box.h);
    ctx.moveTo(box.x, gy);
    ctx.lineTo(box.x + box.w, gy);
  }
  ctx.stroke();

  // Frame border.
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 1.5 * px;
  ctx.strokeRect(box.x, box.y, box.w, box.h);

  // Handles.
  const hs = HANDLE_HALF * px;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(70,120,220,0.95)";
  ctx.lineWidth = 1.25 * px;
  for (const h of HANDLE_POS) {
    const hx = box.x + h.nx * box.w;
    const hy = box.y + h.ny * box.h;
    ctx.beginPath();
    ctx.rect(hx - hs, hy - hs, hs * 2, hs * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

// Matches SCREENSHOT_PREVIEW_WIDTH_PX in electron/main.ts so a saved
// annotation renders its thumbnail at the same size as a fresh capture.
const PREVIEW_WIDTH_PX = 320;

// Breathing room kept between the screenshot and the matte edges, so even a
// full-width capture floats inside the workspace instead of bleeding to the rim.
const MATTE_PAD_PX = 36;

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
    editable: { originalPath: string; shapes: Shape[]; crop: CropBox | null },
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

  // Committed crop window into the original image, in image px (null = full
  // frame). Shapes stay in original-image coords, so the crop is a pure view —
  // non-destructive, and independent of the shape undo history.
  const [crop, setCrop] = useState<Box | null>(() => shot.crop ?? null);
  // In-progress crop selection while the crop tool is active, before Apply.
  const [cropDraft, setCropDraft] = useState<Box | null>(null);
  const cropRef = useRef(crop);
  cropRef.current = crop;
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
    mode: "draw" | "move" | "resize" | "none";
    moveId: string | null;
    last: Pt;
    // Set only for "resize": the shape + its box captured at gesture start, plus
    // which handle is being dragged.
    resize?: { shape: Shape; box: Box; nx: number; ny: number };
  } | null>(null);

  // Crop-tool gesture scratch, separate from the shape gesture above.
  const cropGesture = useRef<{
    mode: "draw" | "move" | "resize";
    start: Pt; // pointer origin (draw) or grab point (move)
    box: Box; // crop box at gesture start
    nx?: number;
    ny?: number;
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

  // The visible window into the image. While cropping we show the whole image so
  // any region can be reframed; otherwise the committed crop (or the full image).
  const view = useMemo<Box>(() => {
    const full = { x: 0, y: 0, w: dims.w, h: dims.h };
    if (tool === "crop") return full;
    return crop ?? full;
  }, [tool, crop, dims.w, dims.h]);

  const display = useMemo(() => {
    if (!view.w || !view.h || !stageBox.w || !stageBox.h) return { w: 0, h: 0 };
    // Fit inside the matte with guaranteed margins on all sides (stageBox is the
    // matte's own box, already excluding the header and footer bars).
    const availW = Math.max(1, stageBox.w - MATTE_PAD_PX * 2);
    const availH = Math.max(1, stageBox.h - MATTE_PAD_PX * 2);
    const scale = Math.min(availW / view.w, availH / view.h, 2.5);
    return { w: Math.round(view.w * scale), h: Math.round(view.h * scale) };
  }, [view, stageBox]);

  // Entering/leaving the crop tool: seed the pending selection from the current
  // crop (or the whole image), and drop any shape selection/draft in progress.
  useEffect(() => {
    if (tool !== "crop") {
      setCropDraft(null);
      return;
    }
    if (!dims.w || !dims.h) return;
    setSelectedId(null);
    setDraft(null);
    setCropDraft(cropRef.current ?? { x: 0, y: 0, w: dims.w, h: dims.h });
  }, [tool, dims.w, dims.h]);

  // WIDTHS/TEXT_SIZES are tuned as apparent sizes for a full-screen Retina
  // capture displayed at ~0.5x. Small region captures display zoomed (up to
  // 2.5x), which would blow marks up 5x on screen — so normalize by the actual
  // display scale to keep the apparent size constant.
  const sizeScale = display.w > 0 && view.w > 0 ? view.w / display.w / 2 : 1;
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
      // The canvas is sized to the current view window; translate so the image is
      // drawn in original-image coordinates and only the window shows.
      ctx.clearRect(0, 0, view.w, view.h);
      ctx.save();
      ctx.translate(-view.x, -view.y);
      ctx.drawImage(img, 0, 0, dims.w, dims.h);
      for (const s of list) {
        if (textDraft?.editingId === s.id) continue; // hidden while re-editing
        drawShape(ctx, s);
      }
      if (draft) drawShape(ctx, draft);

      // Hairline weight: keep marquee/handle lines ~1.5px on screen at any zoom.
      const px = view.w / Math.max(1, display.w);

      if (tool === "crop" && cropDraft) {
        drawCropOverlay(ctx, cropDraft, dims.w, dims.h, px);
      } else if (withSelection && selectedId) {
        const sel = list.find((s) => s.id === selectedId);
        if (sel) {
          const b = shapeBox(sel, ctx);
          ctx.save();
          ctx.setLineDash([4 * px, 3 * px]);
          ctx.lineWidth = 1.5 * px;
          ctx.strokeStyle = "rgba(130,175,255,0.95)";
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          ctx.setLineDash([]);
          const hs = HANDLE_HALF * px;
          for (const hnd of handlesFor(sel, b)) {
            ctx.beginPath();
            ctx.rect(hnd.x - hs, hnd.y - hs, hs * 2, hs * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.lineWidth = 1.25 * px;
            ctx.strokeStyle = "rgba(70,120,220,0.95)";
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      ctx.restore();
    },
    [view, dims.w, dims.h, display.w, draft, selectedId, textDraft, tool, cropDraft],
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
      // Map into the view window, then offset back into original-image coords.
      return {
        x: view.x + ((clientX - r.left) / r.width) * view.w,
        y: view.y + ((clientY - r.top) / r.height) * view.h,
      };
    },
    [view],
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

      if (tool === "crop") {
        const cur = cropDraft ?? { x: 0, y: 0, w: dims.w, h: dims.h };
        const hr = HANDLE_HIT * (view.w / Math.max(1, display.w));
        // Grab a handle to resize, the body to move, or empty space to reframe.
        for (const h of HANDLE_POS) {
          const hx = cur.x + h.nx * cur.w;
          const hy = cur.y + h.ny * cur.h;
          if (Math.abs(p.x - hx) <= hr && Math.abs(p.y - hy) <= hr) {
            cropGesture.current = { mode: "resize", start: p, box: cur, nx: h.nx, ny: h.ny };
            return;
          }
        }
        if (boxHit(cur, p)) {
          cropGesture.current = { mode: "move", start: p, box: cur };
        } else {
          cropGesture.current = { mode: "draw", start: p, box: cur };
          setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
        }
        return;
      }

      if (tool === "select") {
        const ctx = canvas.getContext("2d")!;
        // Grabbing a resize handle of the already-selected shape takes priority
        // over hit-testing shapes underneath it.
        if (selectedId) {
          const sel = start.find((s) => s.id === selectedId);
          if (sel) {
            const b = shapeBox(sel, ctx);
            const hr = HANDLE_HIT * (dims.w / Math.max(1, display.w));
            for (const hnd of handlesFor(sel, b)) {
              if (Math.abs(p.x - hnd.x) <= hr && Math.abs(p.y - hnd.y) <= hr) {
                gesture.current = {
                  startShapes: start,
                  mode: "resize",
                  moveId: selectedId,
                  last: p,
                  resize: { shape: sel, box: b, nx: hnd.nx, ny: hnd.ny },
                };
                return;
              }
            }
          }
        }
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
    [color, commitText, cropDraft, dims.h, dims.w, display.w, selectedId, status, strokeWidth, textDraft, textSize, tool, toImage, view.w],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      // Active crop drag takes priority over everything else.
      const cg = cropGesture.current;
      if (cg) {
        const p = toImage(e.clientX, e.clientY);
        if (cg.mode === "draw") {
          setCropDraft({
            x: Math.min(cg.start.x, p.x),
            y: Math.min(cg.start.y, p.y),
            w: Math.abs(p.x - cg.start.x),
            h: Math.abs(p.y - cg.start.y),
          });
        } else if (cg.mode === "move") {
          const dx = p.x - cg.start.x;
          const dy = p.y - cg.start.y;
          setCropDraft({
            x: Math.min(Math.max(0, cg.box.x + dx), dims.w - cg.box.w),
            y: Math.min(Math.max(0, cg.box.y + dy), dims.h - cg.box.h),
            w: cg.box.w,
            h: cg.box.h,
          });
        } else if (cg.nx !== undefined && cg.ny !== undefined) {
          setCropDraft(resizeCrop(cg.box, cg.nx, cg.ny, p, dims.w, dims.h));
        }
        return;
      }

      // Cursor affordance for the crop frame while hovering (no drag yet).
      if (tool === "crop" && cropDraft && canvasRef.current) {
        const cv = canvasRef.current;
        const hp = toImage(e.clientX, e.clientY);
        const hr = HANDLE_HIT * (view.w / Math.max(1, display.w));
        let cur = "crosshair";
        for (const h of HANDLE_POS) {
          const hx = cropDraft.x + h.nx * cropDraft.w;
          const hy = cropDraft.y + h.ny * cropDraft.h;
          if (Math.abs(hp.x - hx) <= hr && Math.abs(hp.y - hy) <= hr) {
            cur = resizeCursor(h.nx, h.ny);
            break;
          }
        }
        if (cur === "crosshair" && boxHit(cropDraft, hp)) cur = "move";
        cv.style.cursor = cur;
        return;
      }

      // Cursor affordance for the resize handles while hovering (no drag yet).
      if (!gesture.current && tool === "select" && selectedId && canvasRef.current) {
        const cv = canvasRef.current;
        const hctx = cv.getContext("2d")!;
        const sel = shapesRef.current.find((s) => s.id === selectedId);
        const hp = toImage(e.clientX, e.clientY);
        let cur = "default";
        if (sel) {
          const b = shapeBox(sel, hctx);
          const hr = HANDLE_HIT * (dims.w / Math.max(1, display.w));
          for (const hnd of handlesFor(sel, b)) {
            if (Math.abs(hp.x - hnd.x) <= hr && Math.abs(hp.y - hnd.y) <= hr) {
              cur = resizeCursor(hnd.nx, hnd.ny);
              break;
            }
          }
          if (cur === "default" && boxHit(b, hp)) cur = "move";
        }
        cv.style.cursor = cur;
      }

      const g = gesture.current;
      if (!g || g.mode === "none") return;
      const p = toImage(e.clientX, e.clientY);

      if (g.mode === "resize" && g.resize) {
        const { shape, box, nx, ny } = g.resize;
        const ax = box.x + (1 - nx) * box.w; // fixed opposite anchor
        const ay = box.y + (1 - ny) * box.h;
        const ox = box.x + nx * box.w; // grabbed handle's start position
        const oy = box.y + ny * box.h;
        // Clamp to a small positive minimum so a shape can't collapse or flip.
        let sx = nx === 0.5 ? 1 : Math.max(0.05, (p.x - ax) / (ox - ax));
        let sy = ny === 0.5 ? 1 : Math.max(0.05, (p.y - ay) / (oy - ay));
        // Text and shift-drag scale uniformly to preserve aspect ratio.
        if (shape.type === "text" || e.shiftKey) {
          const k = Math.max(sx, sy);
          if (nx !== 0.5) sx = k;
          if (ny !== 0.5) sy = k;
        }
        const next = scaleShape(shape, ax, ay, sx, sy);
        setShapes((prev) => prev.map((s) => (s.id === g.moveId ? next : s)));
        return;
      }

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
    [cropDraft, dims.h, dims.w, display.w, selectedId, toImage, tool, view.w],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const cg = cropGesture.current;
      if (cg) {
        cropGesture.current = null;
        try {
          canvasRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        // A too-small draw (usually just a click) reverts to the prior frame;
        // otherwise snap to whole pixels within the image.
        setCropDraft((d) => {
          if (!d) return d;
          if (cg.mode === "draw" && (d.w < CROP_MIN || d.h < CROP_MIN)) return cg.box;
          return clampCrop(d, dims.w, dims.h);
        });
        return;
      }

      const g = gesture.current;
      gesture.current = null;
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!g) return;

      if (g.mode === "move" || g.mode === "resize") {
        // Commit the moved/resized state to history (shapes already reflect it).
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
    [dims.h, dims.w, finalize, sizeScale],
  );

  /* ---- crop apply / reset ---- */
  // Commit the pending crop frame, then move to `next`. Leaving the crop tool by
  // any route (Enter, Apply, or picking another tool) applies the frame — only
  // Escape discards it — so a drawn selection is never silently thrown away.
  const commitCropAndSwitch = useCallback(
    (next: Tool) => {
      if (tool === "crop" && next !== "crop" && cropDraft) {
        const b = clampCrop(cropDraft, dims.w, dims.h);
        const full = b.x === 0 && b.y === 0 && b.w === dims.w && b.h === dims.h;
        setCrop(full ? null : b);
      }
      setTool(next);
    },
    [tool, cropDraft, dims.w, dims.h],
  );

  const applyCrop = useCallback(() => commitCropAndSwitch("select"), [commitCropAndSwitch]);

  const resetCrop = useCallback(() => {
    setCrop(null);
    setCropDraft({ x: 0, y: 0, w: dims.w, h: dims.h });
  }, [dims.w, dims.h]);

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
      const cropping = tool === "crop";
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (typing) setTextDraft(null);
        else if (cropping) setTool("select"); // leave crop, keep the applied frame
        else onCancel();
        return;
      }
      if (typing) return; // let the textarea handle everything else
      if (cropping && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        applyCrop();
        return;
      }
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
        commitCropAndSwitch(hit.tool); // switching tools applies a pending crop
      }
    };
    // Capture phase so app-global hotkeys don't also fire underneath.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [applyCrop, commitCropAndSwitch, deleteSelected, onCancel, redo, selectedId, textDraft, tool, undo]);

  /* ---- export ---- */
  // Flattens the screenshot + annotations to a PNG on disk and returns its
  // path plus a downscaled preview data URL for the floating thumbnail.
  const exportPng = useCallback(async (): Promise<{ path: string; previewDataUrl: string }> => {
    // Export at the current view size — the committed crop (or the full image) —
    // and let render() bake in the same window offset it draws on screen.
    const off = document.createElement("canvas");
    off.width = view.w;
    off.height = view.h;
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

    const scale = Math.min(1, PREVIEW_WIDTH_PX / view.w);
    const thumb = document.createElement("canvas");
    thumb.width = Math.max(1, Math.round(view.w * scale));
    thumb.height = Math.max(1, Math.round(view.h * scale));
    const tctx = thumb.getContext("2d");
    if (!tctx) throw new Error("no ctx");
    tctx.drawImage(off, 0, 0, thumb.width, thumb.height);
    return { path: saved.path, previewDataUrl: thumb.toDataURL("image/png") };
  }, [view.w, view.h, render]);

  const attach = useCallback(async () => {
    if (status !== "ready" || busy) return;
    setBusy("attach");
    try {
      const { path, previewDataUrl } = await exportPng();
      // Persist the edits back to the source entry first, so the annotated
      // image is what history keeps — attaching should never silently drop the
      // changes it just baked into the sent PNG. Then attach the same file.
      onSave(path, previewDataUrl, { originalPath: basePath, shapes: shapesRef.current, crop });
      onAttach(path);
    } catch {
      setBusy(null);
    }
  }, [basePath, busy, crop, exportPng, onAttach, onSave, status]);

  const save = useCallback(async () => {
    if (status !== "ready" || busy) return;
    setBusy("save");
    try {
      const { path, previewDataUrl } = await exportPng();
      onSave(path, previewDataUrl, { originalPath: basePath, shapes: shapesRef.current, crop });
    } catch {
      setBusy(null);
    }
  }, [basePath, busy, crop, exportPng, onSave, status]);

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
    const sx = r.width / view.w;
    // Text coords are in original-image space; subtract the view origin so the
    // input lands over the glyphs even when a crop is active.
    return {
      left: r.left + (textDraft.x - view.x) * sx,
      top: r.top + (textDraft.y - view.y) * (r.height / view.h),
      fontSize: textDraft.fontSize * sx,
      color: textDraft.color,
    };
  }, [textDraft, view, display]);

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
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(4, 7, 10, 0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <style>{ANNOT_CSS}</style>

      {/* A bounded editor window: header toolbar → canvas matte → footer, in
          three tonal steps so it reads as a workspace rather than a floating
          toolbar dropped over the app. */}
      <div className="mc-annot-panel">
        {/* Header: the working toolbar, attached as real app chrome. */}
        <div className="mc-annot-header">
          <div className="mc-annot-bar">
            <div className="mc-annot-group mc-annot-group--tools">
              {TOOLS.map((t) => (
                <button
                  key={t.tool}
                  type="button"
                  className={`mc-annot-tool${tool === t.tool ? " is-active" : ""}`}
                  data-tip={`${t.label} · ${t.key}`}
                  aria-label={t.label}
                  aria-pressed={tool === t.tool}
                  onClick={() => commitCropAndSwitch(t.tool)}
                >
                  <Icon name={t.icon} size={16} />
                </button>
              ))}
            </div>

            <span className="mc-annot-div" />

            <div className="mc-annot-group mc-annot-group--colors">
              {COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  className={`mc-annot-swatch${color === c ? " is-active" : ""}`}
                  data-tip={COLOR_LABELS[i] ?? c}
                  aria-label={COLOR_LABELS[i] ?? `Color ${c}`}
                  aria-pressed={color === c}
                  onClick={() => {
                    setColor(c);
                    recolorSelected(c);
                  }}
                  style={{ background: c }}
                />
              ))}
              <label className="mc-annot-swatch mc-annot-custom" data-tip="Custom color">
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

            <div className="mc-annot-group mc-annot-group--widths">
              {WIDTHS.map((w, i) => (
                <button
                  key={w.label}
                  type="button"
                  className={`mc-annot-width${widthIdx === i ? " is-active" : ""}`}
                  data-tip={w.label}
                  aria-label={w.label}
                  aria-pressed={widthIdx === i}
                  onClick={() => setWidthIdx(i)}
                >
                  <span style={{ width: w.dot, height: w.dot, borderRadius: 999, background: "currentColor" }} />
                </button>
              ))}
            </div>

            <span className="mc-annot-div" />

            <div className="mc-annot-group mc-annot-group--history">
              <button
                type="button"
                className="mc-annot-tool"
                data-tip="Undo · ⌘Z"
                aria-label="Undo"
                disabled={!canUndo}
                onClick={undo}
              >
                <Icon name="undo" size={16} />
              </button>
              <button
                type="button"
                className="mc-annot-tool"
                data-tip="Redo · ⇧⌘Z"
                aria-label="Redo"
                disabled={!canRedo}
                onClick={redo}
              >
                <Icon name="redo" size={16} />
              </button>
              <button
                type="button"
                className="mc-annot-tool"
                data-tip="Clear all"
                aria-label="Clear all"
                disabled={shapes.length === 0}
                onClick={clearAll}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>

          <button
            type="button"
            className="mc-annot-close"
            data-tip="Close · Esc"
            aria-label="Close editor"
            onClick={onCancel}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Canvas matte: the workspace the screenshot floats in. */}
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
                width={view.w || dims.w}
                height={view.h || dims.h}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={onDoubleClick}
                style={{
                  display: "block",
                  width: display.w || "100%",
                  height: display.h || "auto",
                  borderRadius: 8,
                  cursor,
                  touchAction: "none",
                }}
              />
            </div>
          )}
        </div>

        {/* Footer: crop controls while framing, otherwise the primary actions. */}
        <div className="mc-annot-footer">
          {tool === "crop" ? (
            <>
              <div className="mc-annot-footer-hint">
                Drag to frame · ⏎ or pick a tool to apply · Esc to cancel
              </div>
              <div className="mc-annot-actions">
                <button
                  type="button"
                  className="mc-annot-btn"
                  onClick={resetCrop}
                  disabled={!crop}
                >
                  Reset
                </button>
                <button type="button" className="mc-annot-btn is-primary" onClick={applyCrop}>
                  Apply crop
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mc-annot-footer-hint">
                {tool === "text"
                  ? "Click to place text · double-click text to edit"
                  : tool === "select"
                    ? "Drag to move · handles to resize · ⌫ to delete"
                    : "Drag on the image to draw"}
              </div>
              <div className="mc-annot-actions">
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
            </>
          )}
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
.mc-annot-panel {
  display: flex; flex-direction: column;
  width: min(1200px, 94vw); height: min(860px, 92vh);
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 40px 120px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4);
  animation: mc-annot-pop 220ms cubic-bezier(0.16,1,0.3,1);
}
.mc-annot-header {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 10px; border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  position: relative; z-index: 2; /* lift tooltips above the canvas matte below */
}
/* Hover tooltips: instant, styled, and clipped inside the panel. Anchored to the
   button's left edge so they extend into open space and never clip a corner. */
.mc-annot-header [data-tip] { position: relative; }
.mc-annot-header [data-tip]::after {
  content: attr(data-tip);
  position: absolute; top: calc(100% + 7px); left: 0;
  padding: 4px 8px; border-radius: 7px; white-space: nowrap;
  background: var(--surface-3); color: var(--text); border: 1px solid var(--border);
  font-size: 11px; font-weight: 500; font-family: var(--mono); letter-spacing: 0.01em;
  box-shadow: 0 8px 22px rgba(0,0,0,0.45);
  opacity: 0; transform: translateY(-3px); pointer-events: none;
  transition: opacity 110ms ease, transform 110ms ease;
  z-index: 10;
}
.mc-annot-header [data-tip]:hover::after { opacity: 1; transform: translateY(0); transition-delay: 160ms; }
/* Far-right control: extend leftward so it stays inside the panel. */
.mc-annot-close[data-tip]::after { left: auto; right: 0; }
.mc-annot-bar {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  flex: 1; min-width: 0; flex-wrap: wrap;
  /* Leave room for the absolutely-positioned close button so the centered
     toolbar stays optically centered in the header. */
  padding-right: 40px;
}
/* Header-qualified so this outranks the [data-tip] hover-tooltip rule above —
   a bare .mc-annot-close loses the specificity tie and its position: absolute
   would be silently replaced by the tooltip anchor's position: relative,
   dropping the button into the flex flow. */
.mc-annot-header .mc-annot-close {
  position: absolute; top: 50%; right: 10px; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 34px; height: 34px; padding: 0; border-radius: 9px;
  border: 1px solid transparent; background: transparent; color: var(--text-dim);
  cursor: pointer; transition: background 120ms, color 120ms;
}
.mc-annot-close:hover { background: var(--surface-3); color: var(--text); }
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
.mc-annot-stage {
  flex: 1; min-height: 0; position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-0);
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.4);
  background-image:
    radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text) 6%, transparent) 1px, transparent 0);
  background-size: 22px 22px;
}
.mc-annot-canvas-frame {
  border-radius: 10px; overflow: hidden;
  box-shadow: 0 16px 44px rgba(0,0,0,0.55), 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent);
  animation: mc-annot-frame 220ms cubic-bezier(0.16,1,0.3,1);
}
@keyframes mc-annot-pop { from { transform: scale(0.985); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes mc-annot-frame { from { transform: scale(0.99); opacity: 0; } to { transform: none; opacity: 1; } }
.mc-annot-hint { color: var(--text-dim); font-family: var(--mono); font-size: 12px; }
.mc-annot-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 11px 16px; border-top: 1px solid var(--border); background: var(--surface-2);
}
.mc-annot-actions { display: flex; gap: 8px; }
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
  .mc-annot-root, .mc-annot-panel, .mc-annot-canvas-frame { animation: none; }
  .mc-annot-header [data-tip]::after,
  .mc-annot-header [data-tip]:hover::after { transform: none; transition: opacity 110ms ease; }
}
/* Narrow windows (the focus-mode floating card most of all): the single-row
   toolbar needs ~835px, and free flex wrapping breaks it into ragged rows with
   dividers stretched across them. Below that, lay the four groups out as a
   deliberate 2×2 grid instead — tools + history on top, colors + widths
   below — and pin the close button to the first row. */
@media (max-width: 940px) {
  .mc-annot-header { padding: 8px 10px; }
  .mc-annot-bar {
    display: grid;
    grid-template-columns: auto auto;
    justify-content: center;
    align-items: center;
    justify-items: start;
    row-gap: 5px; column-gap: 14px;
  }
  .mc-annot-div { display: none; }
  .mc-annot-group--tools { order: 1; }
  .mc-annot-group--history { order: 2; }
  .mc-annot-group--colors { order: 3; }
  .mc-annot-group--widths { order: 4; }
  /* Align with the first toolbar row instead of floating between rows. */
  .mc-annot-header .mc-annot-close { top: 8px; transform: none; }
}
/* Tighter still: shrink the controls so both grid columns keep fitting. */
@media (max-width: 520px) {
  .mc-annot-bar { column-gap: 8px; }
  .mc-annot-tool { width: 28px; height: 28px; border-radius: 8px; }
  .mc-annot-width { width: 24px; height: 28px; border-radius: 8px; }
  .mc-annot-swatch { width: 18px; height: 18px; }
  .mc-annot-close { width: 28px; height: 28px; }
  /* The hint is dropped below, leaving the actions as the footer's only child —
     space-between would park them at the left, so pin them right instead. */
  .mc-annot-footer { padding: 9px 10px; gap: 10px; justify-content: flex-end; }
  .mc-annot-footer-hint { display: none; }
}
/* Down to the minimum focus-window width (320px): one centered group per row.
   The close button joins the header flow (top-right, beside the first row) and
   the bar reclaims its clearance, so the 8-tool row fits even at 320 with the
   tool buttons slightly narrowed. */
@media (max-width: 440px) {
  .mc-annot-bar {
    grid-template-columns: auto;
    row-gap: 4px;
    justify-items: center;
    padding-right: 0;
  }
  .mc-annot-tool { width: 26px; }
  .mc-annot-header .mc-annot-close {
    position: static; top: auto; transform: none; align-self: flex-start; flex: none;
  }
  /* Keep all three footer actions on one line down to the 320px minimum. */
  .mc-annot-btn { padding: 0 12px; white-space: nowrap; }
  .mc-annot-actions { gap: 6px; }
}
`;
