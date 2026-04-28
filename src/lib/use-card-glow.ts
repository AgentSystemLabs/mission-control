import { useEffect, useRef } from "react";

export function useCardGlow<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gx", `${e.clientX - r.left}px`);
      el.style.setProperty("--gy", `${e.clientY - r.top}px`);
    };
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      el.dataset.glow = "1";
      document.body.dataset.cardGlow = "1";
    };
    const onLeave = () => {
      delete el.dataset.glow;
      delete document.body.dataset.cardGlow;
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      delete document.body.dataset.cardGlow;
    };
  }, []);

  return ref;
}
