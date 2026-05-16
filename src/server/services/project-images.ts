import * as fs from "node:fs";
import * as path from "node:path";
import { resolveUserDataDir } from "~/db/client";
import { findProjectById } from "../repositories/projects.repo";
import { updateProject } from "./projects";
import type { Project } from "~/db/schema";

export const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function projectImagesDir(): string {
  return path.join(resolveUserDataDir(), "project-images");
}

export function projectImageAbsolutePath(filename: string): string {
  // Reject anything that tries to escape the directory.
  const safe = path.basename(filename);
  return path.join(projectImagesDir(), safe);
}

export function setProjectImage(projectId: string, filename: string): Project | null {
  return updateProject(projectId, { imagePath: filename });
}

export function clearProjectImage(projectId: string): Project | null {
  const existing = findProjectById(projectId);
  if (!existing) return null;
  if (existing.imagePath) deleteProjectImageFile(existing.imagePath);
  return updateProject(projectId, { imagePath: null });
}

export function deleteProjectImageFile(filename: string): void {
  try {
    const abs = projectImageAbsolutePath(filename);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* swallow — best-effort cleanup */
  }
}

export function deleteAllProjectImagesFor(projectId: string): void {
  try {
    const dir = projectImagesDir();
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const base = name.split(".")[0];
      if (base === projectId) fs.unlinkSync(path.join(dir, name));
    }
  } catch {
    /* swallow */
  }
}
