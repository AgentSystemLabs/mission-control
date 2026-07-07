// Surface tint — how much of the accent color is mixed into the surface
// tokens (--bg, --surface-0..3, --terminal-bg). Shared by the settings
// controller (persistence + validation) and the renderer (DOM application),
// so the enum lives here rather than in src/lib.
//
//  - "off":    surfaces render each style's exact base palette (the pre-tint
//              look)
//  - "subtle": a whisper of accent in the ground — the app leans toward the
//              chosen color without losing the style's character
//  - "vivid":  a clearly visible accent wash across backgrounds, headers,
//              bars and session grounds
export const SURFACE_TINTS = ["off", "subtle", "vivid"] as const;

export type SurfaceTint = (typeof SURFACE_TINTS)[number];

export const DEFAULT_SURFACE_TINT: SurfaceTint = "subtle";

export function isSurfaceTint(value: unknown): value is SurfaceTint {
  return (
    typeof value === "string" &&
    (SURFACE_TINTS as readonly string[]).includes(value)
  );
}
