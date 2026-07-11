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

// Each source: full Color blend across the image, or masked so only saturated
// pixels (the colored lights) get re-themed and neutral metal stays as-is.
// edgeFade keys out the opaque black margin between the PNG edge and the
// frame art so the app background shows through around card corners.
const SOURCES = [
  { base: "button_filled", mask: "all" },
  { base: "panel_focused", mask: "all", edgeFade: true },
  { base: "square", mask: "all", opacity: 0.15, edgeFade: true },
  { base: "shell", mask: "saturation", threshold: 0.15, ramp: 0.1 },
];

// Mirror of src/lib/accent-colors.ts. Kept here so this script has zero TS deps.
const ACCENT_COLORS = [
  { id: "deep-orange", hex: "#ff5a1f" },
  { id: "terracotta", hex: "#d0854e" },
  { id: "blue", hex: "#3b82f6" },
  { id: "green", hex: "#22c55e" },
  { id: "teal", hex: "#14b8a6" },
  { id: "cyan", hex: "#06b6d4" },
  { id: "purple", hex: "#a855f7" },
  { id: "magenta", hex: "#d946ef" },
  { id: "pink", hex: "#f472b6" },
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

// Flood-fill the near-black background connected to the image edges and
// return a per-pixel alpha multiplier: 0 across the background margin,
// ramping up through the antialiased fringe so the frame art keeps a soft
// edge instead of a hard black cutout.
const EDGE_FILL_MAX = 2; // max channel value treated as background black
const FRINGE_RADIUS = 2; // px of soft falloff between background and art
function computeEdgeAlpha(png) {
  const { width: w, height: h, data } = png;
  const maxChan = (i) => Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const filled = new Uint8Array(w * h);
  const queue = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (!filled[i] && maxChan(i) <= EDGE_FILL_MAX) {
      filled[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (queue.length) {
    const i = queue.pop();
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const alpha = new Float32Array(w * h).fill(1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (filled[i]) {
        alpha[i] = 0;
        continue;
      }
      let d = FRINGE_RADIUS + 1;
      for (let dy = -FRINGE_RADIUS; dy <= FRINGE_RADIUS && d > 1; dy++) {
        for (let dx = -FRINGE_RADIUS; dx <= FRINGE_RADIUS; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (filled[ny * w + nx]) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
        }
      }
      if (d <= FRINGE_RADIUS) alpha[i] = d / (FRINGE_RADIUS + 1);
    }
  }
  return alpha;
}

function tintBuffer(png, themeHex, opts, edgeAlpha) {
  const { r: tr, g: tg, b: tb } = hexToRgb(themeHex);
  const { h: th, s: ts } = rgbToHsl(tr, tg, tb);
  const mask = opts?.mask ?? "all";
  const threshold = opts?.threshold ?? 0.15;
  const ramp = opts?.ramp ?? 0.1;
  const opacity = opts?.opacity ?? 1;
  const out = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    const { s, l } = rgbToHsl(r, g, b);
    // Color blend: theme hue+sat at original luminance.
    const tinted = hslToRgb(th, ts, l);
    let w = 1;
    if (mask === "saturation") {
      // Soft ramp around threshold so the transition isn't a hard edge.
      w = Math.max(0, Math.min(1, (s - threshold) / ramp));
    }
    w *= opacity;
    out.data[i] = Math.round(r * (1 - w) + tinted.r * w);
    out.data[i + 1] = Math.round(g * (1 - w) + tinted.g * w);
    out.data[i + 2] = Math.round(b * (1 - w) + tinted.b * w);
    out.data[i + 3] = edgeAlpha ? Math.round(a * edgeAlpha[i / 4]) : a;
  }
  return PNG.sync.write(out);
}

async function processSource(source) {
  const { base, ...opts } = source;
  const srcPath = join(BORDERS_DIR, `${base}.png`);
  const buf = await readFile(srcPath);
  const png = PNG.sync.read(buf);
  const edgeAlpha = opts.edgeFade ? computeEdgeAlpha(png) : null;
  for (const { id, hex } of ACCENT_COLORS) {
    const outPath = join(BORDERS_DIR, `${base}_${id}.png`);
    const tinted = tintBuffer(png, hex, opts, edgeAlpha);
    await writeFile(outPath, tinted);
    console.log(`  wrote ${base}_${id}.png`);
  }
}

async function main() {
  for (const source of SOURCES) {
    console.log(`Tinting ${source.base}.png (mask=${source.mask ?? "all"}) …`);
    await processSource(source);
  }
  console.log(`\nGenerated ${SOURCES.length * ACCENT_COLORS.length} themed PNGs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
