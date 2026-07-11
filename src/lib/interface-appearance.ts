// Applies the interface (UI) appearance settings: font face and scale.
// The face overrides the theme's --sans/--font-sans via inline vars on <html>
// (inline wins over every theme stylesheet block; clearing hands control back
// to the active theme). The scale rides the Electron window zoom factor so
// every px-sized element grows together; the browser fallback uses CSS zoom.
import { getElectron } from "~/lib/electron";
import type { InterfaceFontScale } from "~/shared/terminal-appearance";

const SANS_VARS = ["--sans", "--font-sans"] as const;

/** Wrap a user-picked family in quotes and append the UI sans fallback stack. */
export function interfaceFontStack(family: string): string {
  return `"${family.replace(/"/g, "")}", ui-sans-serif, system-ui, sans-serif`;
}

export function applyInterfaceFontFamily(family: string | null): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  for (const name of SANS_VARS) {
    if (family) style.setProperty(name, interfaceFontStack(family));
    else style.removeProperty(name);
  }
}

export function applyInterfaceFontScale(scale: InterfaceFontScale): void {
  if (typeof document === "undefined") return;
  const electron = getElectron();
  if (electron?.setZoomFactor) {
    void electron.setZoomFactor(scale);
    return;
  }
  // Browser dev fallback: CSS zoom scales layout the same way, minus the
  // crisper native rasterization the Electron zoom factor gives.
  document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
}
