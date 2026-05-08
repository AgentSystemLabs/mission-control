import { useEffect, useRef } from "react";
import { useSettings } from "~/queries";

export function CursorGlow() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { data: settings } = useSettings();
  const enabled = !(settings?.mouseGradientDisabled ?? false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      el.style.setProperty("--x", `${e.clientX}px`);
      el.style.setProperty("--y", `${e.clientY}px`);
      el.dataset.active = "1";
    };
    const onLeave = () => {
      delete el.dataset.active;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      delete el.dataset.active;
    };
  }, [enabled]);

  if (!enabled) return null;
  return <div ref={ref} className="cursor-glow" aria-hidden />;
}
