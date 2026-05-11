#!/usr/bin/env node
// Generate theme-tinted variants of button_filled.png and panel_focused.png.
// Mimics Figma's "Color" blend (theme hue+sat over original luminance) so the
// 9-slice textures keep their highlights/shadows while taking on each accent.
//
// Usage: node scripts/gen-theme-images.mjs

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BORDERS_DIR = join(ROOT, "public", "borders");

const SOURCES = ["button_filled", "panel_focused"];

// Mirror of src/lib/accent-colors.ts. Kept here so this script has zero TS deps.
const ACCENT_COLORS = [
  { id: "deep-orange", hex: "#ff5a1f" },
  { id: "blue", hex: "#3b82f6" },
  { id: "green", hex: "#22c55e" },
  { id: "teal", hex: "#14b8a6" },
  { id: "cyan", hex: "#06b6d4" },
  { id: "purple", hex: "#a855f7" },
  { id: "magenta", hex: "#d946ef" },
  { id: "red", hex: "#ef4444" },
  { id: "amber", hex: "#f59e0b" },
  { id: "lime", hex: "#84cc16" },
  { id: "indigo", hex: "#6366f1" },
  { id: "slate", hex: "#94a3b8" },
];

function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function tintBuffer(png, themeHex) {
  const { r: tr, g: tg, b: tb } = hexToRgb(themeHex);
  const { h: th, s: ts } = rgbToHsl(tr, tg, tb);
  const out = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    // Use original luminance; replace hue+sat with theme color (Figma "Color" blend).
    const { l } = rgbToHsl(r, g, b);
    const out_rgb = hslToRgb(th, ts, l);
    out.data[i] = out_rgb.r;
    out.data[i + 1] = out_rgb.g;
    out.data[i + 2] = out_rgb.b;
    out.data[i + 3] = a;
  }
  return PNG.sync.write(out);
}

async function processSource(base) {
  const srcPath = join(BORDERS_DIR, `${base}.png`);
  const buf = await readFile(srcPath);
  const png = PNG.sync.read(buf);
  for (const { id, hex } of ACCENT_COLORS) {
    const outPath = join(BORDERS_DIR, `${base}_${id}.png`);
    const tinted = tintBuffer(png, hex);
    await writeFile(outPath, tinted);
    console.log(`  wrote ${base}_${id}.png`);
  }
}

async function main() {
  for (const base of SOURCES) {
    console.log(`Tinting ${base}.png …`);
    await processSource(base);
  }
  console.log(`\nGenerated ${SOURCES.length * ACCENT_COLORS.length} themed PNGs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
