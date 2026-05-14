import { useCallback, useRef } from "react";
import { useSettings } from "~/queries";

export function useCardGlow<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const { data: settings } = useSettings();
  const enabled = !(settings?.mouseGradientDisabled ?? false);

  return useCallback((el: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    ref.current = el;
    if (!el) return;
    delete el.dataset.glow;
    delete document.body.dataset.cardGlow;
    if (!enabled) return;

    const updatePosition = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gx", `${e.clientX - r.left}px`);
      el.style.setProperty("--gy", `${e.clientY - r.top}px`);
    };
    const onMove = (e: PointerEvent) => {
      updatePosition(e);
    };
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      updatePosition(e);
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
    cleanupRef.current = () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      delete el.dataset.glow;
      delete document.body.dataset.cardGlow;
    };
  }, [enabled]);
}
