#!/usr/bin/env node
// Convert large PNG assets to WebP to shrink the asar bundle.
//
// Targets:
//   - public/images/doors.png  -> public/images/doors.webp
//   - public/borders/*.png     -> public/borders/*.webp
//
// Borders are NOT downsampled: the CSS uses absolute-pixel `border-image-slice`
// values (e.g. 120, 64) keyed to the source dimensions; resizing would distort
// the 9-slice rendering. WebP alone already yields ~70% savings.
//
// Usage: node scripts/convert-images-to-webp.mjs

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const WEBP_QUALITY = 80;
const BORDER_MAX_EDGE = 256; // downsample 9-slice borders above this

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function convert(srcAbs, { downsampleBorder }) {
  const dst = srcAbs.replace(/\.png$/i, ".webp");
  const inputBuf = await readFile(srcAbs);
  const inputSize = inputBuf.length;

  let pipeline = sharp(inputBuf);
  const meta = await pipeline.metadata();

  let resized = false;
  if (
    downsampleBorder &&
    meta.width &&
    meta.height &&
    Math.max(meta.width, meta.height) > BORDER_MAX_EDGE
  ) {
    const longest = Math.max(meta.width, meta.height);
    const scale = BORDER_MAX_EDGE / longest;
    const newW = Math.round(meta.width * scale);
    const newH = Math.round(meta.height * scale);
    pipeline = pipeline.resize(newW, newH, { fit: "fill" });
    resized = true;
  }

  const out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
  await writeFile(dst, out);

  return {
    src: srcAbs,
    dst,
    inputSize,
    outputSize: out.length,
    width: meta.width,
    height: meta.height,
    resized,
  };
}

async function main() {
  const tasks = [];

  // doors.png
  const doors = join(ROOT, "public", "images", "doors.png");
  try {
    await stat(doors);
    tasks.push({ src: doors, downsampleBorder: false });
  } catch {
    console.warn("skip: doors.png not found at", doors);
  }

  // borders/*.png
  const bordersDir = join(ROOT, "public", "borders");
  const entries = await readdir(bordersDir);
  for (const name of entries) {
    if (extname(name).toLowerCase() !== ".png") continue;
    tasks.push({ src: join(bordersDir, name), downsampleBorder: false });
  }

  let totalIn = 0;
  let totalOut = 0;
  for (const t of tasks) {
    const r = await convert(t.src, { downsampleBorder: t.downsampleBorder });
    totalIn += r.inputSize;
    totalOut += r.outputSize;
    const dim = `${r.width}x${r.height}${r.resized ? " (resized)" : ""}`;
    console.log(
      `${basename(r.src)} ${dim}: ${fmtBytes(r.inputSize)} -> ${fmtBytes(r.outputSize)}`
    );
  }
  console.log(
    `\nTotal: ${fmtBytes(totalIn)} -> ${fmtBytes(totalOut)} (saved ${fmtBytes(totalIn - totalOut)}, ${((1 - totalOut / totalIn) * 100).toFixed(1)}%)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
