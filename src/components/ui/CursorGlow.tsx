import { useEffect, useRef } from "react";
import { useSettings } from "~/queries";
import { usePowerSaveActive } from "~/lib/power-save";

export function CursorGlow() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { data: settings } = useSettings();
  // A pointer-following GPU gradient is pure decoration — first thing to go
  // when battery saver kicks in.
  const powerSave = usePowerSaveActive();
  const enabled = !(settings?.mouseGradientDisabled ?? false) && !powerSave;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    // pointermove can fire many times per frame; batch the CSS-var writes into a
    // single rAF so we touch style at most once per painted frame instead of on
    // every event. Only the latest coordinates matter.
    let nextX = 0;
    let nextY = 0;
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      el.style.setProperty("--x", `${nextX}px`);
      el.style.setProperty("--y", `${nextY}px`);
      el.dataset.active = "1";
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      nextX = e.clientX;
      nextY = e.clientY;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };
    const onLeave = () => {
      // Cancel any pending flush so it can't re-set data-active after we clear
      // it — otherwise moving the pointer out of the window in the same frame as
      // a queued move would leave the glow stuck on at its last position.
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      delete el.dataset.active;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      delete el.dataset.active;
    };
  }, [enabled]);

  if (!enabled) return null;
  return <div ref={ref} className="cursor-glow" aria-hidden />;
}
