import { z } from "zod";
import { SCRATCH_PAD_CONTENT_MAX } from "~/shared/scratch-pads";
import {
  createScratchPad,
  deleteScratchPad,
  listScratchPads,
  updateScratchPad,
} from "../services/scratch-pads";
import { json, noContent, parseJsonBody, rethrowUnlessDomain } from "./_helpers";

const createBody = z.object({
  content: z.string().max(SCRATCH_PAD_CONTENT_MAX).optional(),
});

const updateBody = z.object({
  content: z.string().max(SCRATCH_PAD_CONTENT_MAX),
});

export async function list(projectId: string): Promise<Response> {
  try {
    return json({ scratchPads: listScratchPads(projectId) });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function create(projectId: string, request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createBody);
  if (!parsed.ok) return parsed.response;
  try {
    const scratchPad = createScratchPad({ projectId, content: parsed.data.content });
    return json({ scratchPad }, { status: 201 });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function update(
  projectId: string,
  padId: string,
  request: Request,
): Promise<Response> {
  const parsed = await parseJsonBody(request, updateBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json({ scratchPad: updateScratchPad(projectId, padId, parsed.data) });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function remove(projectId: string, padId: string): Promise<Response> {
  try {
    deleteScratchPad(projectId, padId);
    return noContent();
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}
