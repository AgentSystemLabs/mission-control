import {
  SCRATCH_PAD_CONTENT_MAX,
  type ScratchPadCreateInput,
  type ScratchPadUpdateInput,
  type ScratchPadView,
} from "~/shared/scratch-pads";
import type { ScratchPad } from "~/db/schema";
import { NotFoundError } from "../errors";
import { findProjectById } from "../repositories/projects.repo";
import {
  deleteScratchPadRow,
  getScratchPadById,
  insertScratchPadRow,
  listScratchPadsByProject,
  updateScratchPadRow,
} from "../repositories/scratch-pads.repo";
import { newId } from "./_ids";

export function toScratchPadView(row: ScratchPad): ScratchPadView {
  return {
    id: row.id,
    projectId: row.projectId,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cleanContent(raw: string | undefined): string {
  return (raw ?? "").slice(0, SCRATCH_PAD_CONTENT_MAX);
}

/**
 * Item routes are nested under the project, so every mutation re-checks that
 * the pad belongs to the addressed project — a foreign pad id reads as
 * not-found rather than mutating another project's pad.
 */
function getOwnedScratchPad(projectId: string, padId: string): ScratchPad {
  const row = getScratchPadById(padId);
  if (!row || row.projectId !== projectId) throw new NotFoundError("scratch pad not found");
  return row;
}

export function listScratchPads(projectId: string): ScratchPadView[] {
  const project = findProjectById(projectId);
  if (!project) throw new NotFoundError("project not found");
  return listScratchPadsByProject(projectId).map(toScratchPadView);
}

export function createScratchPad(input: ScratchPadCreateInput): ScratchPadView {
  const project = findProjectById(input.projectId);
  if (!project) throw new NotFoundError("project not found");
  const now = Date.now();
  const id = newId("pad");
  insertScratchPadRow({
    id,
    projectId: input.projectId,
    content: cleanContent(input.content),
    createdAt: now,
    updatedAt: now,
  });
  const row = getScratchPadById(id);
  if (!row) throw new NotFoundError("scratch pad not found");
  return toScratchPadView(row);
}

export function updateScratchPad(
  projectId: string,
  padId: string,
  input: ScratchPadUpdateInput,
): ScratchPadView {
  getOwnedScratchPad(projectId, padId);
  const updated = updateScratchPadRow(padId, {
    content: cleanContent(input.content),
    updatedAt: Date.now(),
  });
  if (!updated) throw new NotFoundError("scratch pad not found");
  return toScratchPadView(updated);
}

export function deleteScratchPad(projectId: string, padId: string): void {
  getOwnedScratchPad(projectId, padId);
  deleteScratchPadRow(padId);
}
