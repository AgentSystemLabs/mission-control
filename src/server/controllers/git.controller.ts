import { z } from "zod";
import {
  commit as gitCommit,
  getGitDiff,
  getGitStatus,
  gitErrorPayload,
  push as gitPush,
  stageFiles,
  unstageFiles,
} from "../services/git";
import { handleDomainError, json, jsonError, notFound, parseJsonBody } from "./_helpers";

const idParam = z.string().min(1);

const stageBody = z.object({ files: z.array(z.string()).optional().default([]) });
const commitBody = z.object({ autoStage: z.boolean().optional() });

function asGitErrorResponse(e: unknown): Response {
  const payload = gitErrorPayload(e);
  return new Response(
    JSON.stringify({ error: payload.message, stderr: payload.stderr }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

export async function status(rawId: string): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await getGitStatus(parsed.data));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function diff(rawId: string, url: URL): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const file = url.searchParams.get("file");
  if (!file) return jsonError(400, "file is required");
  const stagedParam = url.searchParams.get("staged");
  const staged = stagedParam === "1" || stagedParam === "true";
  try {
    return json(await getGitDiff(idParsed.data, file, staged));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function stage(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, stageBody);
  if (!parsed.ok) return parsed.response;
  try {
    await stageFiles(idParsed.data, parsed.data.files);
    return json({ ok: true });
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function unstage(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, stageBody);
  if (!parsed.ok) return parsed.response;
  try {
    await unstageFiles(idParsed.data, parsed.data.files);
    return json({ ok: true });
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function commit(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, commitBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json(await gitCommit(idParsed.data, { autoStage: parsed.data.autoStage }));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function push(rawId: string): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await gitPush(parsed.data));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}
