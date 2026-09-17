import { isBackgroundImage } from "~/shared/background-image";

// Cache key shared with the pre-hydration script in __root.tsx so the next
// launch can paint the wallpaper before React mounts (no ground-then-image
// pop-in). Keep in sync with PRE_HYDRATION_THEME_SCRIPT.
export const BACKGROUND_IMAGE_CACHE_KEY = "mc:backgroundImage";

/** The cached wallpaper data URL, or null when none is set / storage is empty. */
export function readCachedBackgroundImage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(BACKGROUND_IMAGE_CACHE_KEY);
    return isBackgroundImage(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Apply (or clear) the wallpaper on the document and cache the choice so the
 * pre-hydration script can restore it on the next launch.
 *
 * DOM contract: null removes `data-bg-image` and the `--mc-bg-image` var, so
 * the ground falls back to the theme's `--bg`. A data URL sets both; the
 * `[data-minimal="true"][data-bg-image="true"] body` rule in styles.css reads
 * them, so the image only actually renders under the flat theme — painted
 * ignores it even while one is stored.
 */
export function applyBackgroundImage(image: string | null): void {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (image) {
      root.style.setProperty("--mc-bg-image", `url("${image}")`);
      root.setAttribute("data-bg-image", "true");
    } else {
      root.style.removeProperty("--mc-bg-image");
      root.removeAttribute("data-bg-image");
    }
  }
  if (typeof window === "undefined") return;
  try {
    if (image) {
      window.localStorage.setItem(BACKGROUND_IMAGE_CACHE_KEY, image);
    } else {
      window.localStorage.removeItem(BACKGROUND_IMAGE_CACHE_KEY);
    }
  } catch {
    // ignore quota / privacy-mode errors — the server copy is the source of truth
  }
}

// Downscale the longest edge to this before encoding. A wallpaper only ever
// backs a desktop window, so anything larger is wasted bytes in the settings
// blob and localStorage.
const MAX_EDGE_PX = 2560;
// JPEG quality for the re-encode. 0.82 keeps a photographic wallpaper clean
// while landing most images comfortably under the persisted-size cap.
const ENCODE_QUALITY = 0.82;

export class BackgroundImageError extends Error {}

/**
 * Read an uploaded image file, downscale its longest edge to {@link MAX_EDGE_PX},
 * and re-encode it as a compact JPEG data URL suitable for persisting. Rejects
 * non-images and results that still exceed the stored-size cap after
 * compression (extremely large source images).
 */
export async function compressImageFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new BackgroundImageError("That file isn't an image.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new BackgroundImageError("Couldn't process the image.");
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", ENCODE_QUALITY);
    if (!isBackgroundImage(dataUrl)) {
      throw new BackgroundImageError("That image is too large — try a smaller one.");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new BackgroundImageError("Couldn't read that image."));
    img.src = src;
  });
}
