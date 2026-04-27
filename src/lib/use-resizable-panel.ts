import { useCallback, useEffect, useRef, useState } from "react";

type Axis = "x" | "y";

export function useResizablePanel(opts: {
  storageKey: string;
  axis: Axis;
  defaultSize: number;
  minSize: number;
  maxSize?: (viewport: number) => number;
}) {
  const { storageKey, axis, defaultSize, minSize, maxSize } = opts;

  const [size, setSize] = useState<number>(() => {
    if (typeof window === "undefined") return defaultSize;
    const raw = window.localStorage.getItem(storageKey);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= minSize ? n : defaultSize;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(size));
    } catch {}
  }, [storageKey, size]);

  const dragRef = useRef<{ start: number; startSize: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startCoord = axis === "x" ? e.clientX : e.clientY;
      dragRef.current = { start: startCoord, startSize: size };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const cur = axis === "x" ? ev.clientX : ev.clientY;
        const delta = dragRef.current.start - cur;
        const viewport = axis === "x" ? window.innerWidth : window.innerHeight;
        const upperBound = maxSize ? maxSize(viewport) : viewport - minSize;
        const next = Math.max(minSize, Math.min(upperBound, dragRef.current.startSize + delta));
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
    [axis, size, minSize, maxSize],
  );

  return { size, onMouseDown };
}
