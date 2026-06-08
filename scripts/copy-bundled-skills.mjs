#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, ".agents", "skills");
const targetRoot = path.join(repoRoot, "dist", "bundled-skills");
const BUNDLED_SKILL_NAMES = ["diagram"];

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dest);
      continue;
    }
    if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

if (!fs.existsSync(sourceRoot)) {
  console.error(`[copy-bundled-skills] missing source directory: ${sourceRoot}`);
  process.exit(1);
}

let copied = 0;
for (const skillName of BUNDLED_SKILL_NAMES) {
  const skillDir = path.join(sourceRoot, skillName);
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    console.warn(`[copy-bundled-skills] missing bundled skill: ${skillName}`);
    continue;
  }
  const dest = path.join(targetRoot, skillName);
  fs.rmSync(dest, { recursive: true, force: true });
  copyTree(skillDir, dest);
  copied += 1;
  console.log(`[copy-bundled-skills] copied ${skillName}`);
}

if (copied === 0) {
  console.warn("[copy-bundled-skills] no skills with SKILL.md found");
}
