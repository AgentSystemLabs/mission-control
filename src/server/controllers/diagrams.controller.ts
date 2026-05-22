import { z } from "zod";
import {
  DIAGRAM_FORMATS,
  DIAGRAM_SOURCE_MAX_BYTES,
  DIAGRAM_THEMES,
  DIAGRAM_TITLE_MAX_LENGTH,
} from "~/shared/diagram";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "~/shared/http-status";
import { events } from "../events";
import {
  getDiagramForTask,
  listDiagramsForProject,
  upsertDiagramForTask,
} from "../services/diagram-store";
import { getTask } from "../services/tasks";
import { handleDomainError, json, jsonError, parseJsonBody } from "./_helpers";

const diagramBody = z.object({
  source: z.string().min(1, "source required"),
  title: z.string().max(DIAGRAM_TITLE_MAX_LENGTH).optional(),
  format: z.enum(DIAGRAM_FORMATS).optional().default("mermaid"),
  theme: z.enum(DIAGRAM_THEMES).optional(),
});

export function list(url: URL): Response {
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) return jsonError(HTTP_BAD_REQUEST, "projectId required");
  return json({ diagrams: listDiagramsForProject(projectId) });
}

export function read(url: URL): Response {
  const taskId = url.searchParams.get("taskId")?.trim();
  if (!taskId) return jsonError(HTTP_BAD_REQUEST, "taskId required");
  const diagram = getDiagramForTask(taskId);
  if (!diagram) return jsonError(HTTP_NOT_FOUND, "diagram not found");
  return json({ diagram });
}

export async function submit(url: URL, request: Request): Promise<Response> {
  const taskId = url.searchParams.get("taskId")?.trim();
  if (!taskId) return jsonError(HTTP_BAD_REQUEST, "taskId required");

  const parsed = await parseJsonBody(request, diagramBody);
  if (!parsed.ok) return parsed.response;

  const sourceBytes = Buffer.byteLength(parsed.data.source, "utf8");
  if (sourceBytes > DIAGRAM_SOURCE_MAX_BYTES) {
    return jsonError(HTTP_BAD_REQUEST, `source exceeds ${DIAGRAM_SOURCE_MAX_BYTES} bytes`);
  }

  const task = getTask(taskId);
  if (!task) return jsonError(HTTP_NOT_FOUND, "task not found");

  const title = parsed.data.title?.trim() || null;
  const diagram = upsertDiagramForTask({
    taskId,
    projectId: task.projectId,
    title,
    source: parsed.data.source,
    format: parsed.data.format,
  });

  events.emit("diagram:show", diagram);

  try {
    return json({ ok: true, id: diagram.id, replaced: true });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}
