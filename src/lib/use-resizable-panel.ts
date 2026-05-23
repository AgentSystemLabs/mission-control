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

  useEffect(() => {
    if (storedSize === undefined || storedSize === null) return;
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
    onSizeChange?.(size);
  }, [onSizeChange, storageKey, size]);

  const dragRef = useRef<{ start: number; startSize: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startCoord = axis === "x" ? e.clientX : e.clientY;
      dragRef.current = { start: startCoord, startSize: size };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const cur = axis === "x" ? ev.clientX : ev.clientY;
        const delta =
          resizeEdge === "start"
            ? dragRef.current.start - cur
            : cur - dragRef.current.start;
        const next = clampSize(dragRef.current.startSize + delta);
        setSize(next);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis, size, resizeEdge, clampSize],
  );

  return { size, onMouseDown };
}
