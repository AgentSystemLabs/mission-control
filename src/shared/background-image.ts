// User-uploaded wallpaper that replaces the flat theme's subtle ground. Shared
// by the settings controller (persistence + validation) and the renderer
// (compression + DOM application), so the shape rules live here rather than in
// src/lib. The image is stored as a self-contained data URL — a local Electron
// app has no asset host, and every /api route requires a bearer token that a
// CSS `url()` can't carry, so an embedded data URL is the only thing a
// stylesheet can reference. The renderer downscales/compresses before saving
// (see src/lib/background-image.ts) to keep the persisted string modest.

// ~6 MB of characters. A data URL is ~1.37x the raw bytes, so this caps the
// stored image near ~4 MB — well above the renderer's compression target and
// low enough that the settings payload stays cheap to fetch and cache.
export const BACKGROUND_IMAGE_MAX_LENGTH = 6_000_000;

const DATA_IMAGE_URL_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/** A stored background image is either cleared (null) or an image data URL. */
export function isBackgroundImage(value: unknown): value is string | null {
  if (value === null) return true;
  return (
    typeof value === "string" &&
    value.length <= BACKGROUND_IMAGE_MAX_LENGTH &&
    DATA_IMAGE_URL_RE.test(value)
  );
}
