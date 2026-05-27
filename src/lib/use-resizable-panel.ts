import { useCallback, useEffect, useRef, useState } from "react";

type Axis = "x" | "y";

export function useResizablePanel(opts: {
  storageKey: string;
  axis: Axis;
  defaultSize: number;
  minSize: number;
  maxSize?: (viewport: number) => number;
  resizeEdge?: "start" | "end";
  storedSize?: number | null;
  onSizeChange?: (size: number) => void;
}) {
  const {
    storageKey,
    axis,
    defaultSize,
    minSize,
    maxSize,
    resizeEdge = "start",
    storedSize,
    onSizeChange,
  } = opts;

  const clampSize = useCallback(
    (value: number) => {
      if (typeof window === "undefined") return Math.max(minSize, value);
      const viewport = axis === "x" ? window.innerWidth : window.innerHeight;
      const upperBound = maxSize ? maxSize(viewport) : viewport - minSize;
      return Math.max(minSize, Math.min(upperBound, value));
    },
    [axis, maxSize, minSize],
  );

  const [size, setSize] = useState<number>(() => {
    if (storedSize !== undefined && storedSize !== null) return Math.max(minSize, storedSize);
    if (typeof window === "undefined") return defaultSize;
    const raw = window.localStorage.getItem(storageKey);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= minSize ? n : defaultSize;
  });

  const sizeRef = useRef(size);
  sizeRef.current = size;

  const isDraggingRef = useRef(false);
  const onSizeChangeRef = useRef(onSizeChange);
  onSizeChangeRef.current = onSizeChange;

  useEffect(() => {
    if (storedSize === undefined || storedSize === null) return;
    if (isDraggingRef.current) return;
    setSize((current) => {
      const next = clampSize(storedSize);
      return current === next ? current : next;
    });
  }, [clampSize, storedSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(size));
    } catch {
      /* localStorage unavailable */
    }
  }, [storageKey, size]);

  const dragRef = useRef<{ start: number; startSize: number } | null>(null);

  const finishDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onSizeChangeRef.current?.(sizeRef.current);
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startCoord = axis === "x" ? e.clientX : e.clientY;
      isDraggingRef.current = true;
      dragRef.current = { start: startCoord, startSize: sizeRef.current };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current || !isDraggingRef.current) return;
        const cur = axis === "x" ? ev.clientX : ev.clientY;
        const delta =
          resizeEdge === "start"
            ? dragRef.current.start - cur
            : cur - dragRef.current.start;
        const next = clampSize(dragRef.current.startSize + delta);
        setSize(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        finishDrag();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis, resizeEdge, clampSize, finishDrag],
  );

  return { size, onMouseDown };
}
