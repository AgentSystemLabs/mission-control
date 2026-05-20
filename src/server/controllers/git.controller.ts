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
import { handleDomainError, idParam, json, jsonError, notFound, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";

const stageBody = z.object({
  files: z.array(z.string()).optional().default([]),
  worktreeId: z.string().nullable().optional(),
});
const commitBody = z.object({
  autoStage: z.boolean().optional(),
  worktreeId: z.string().nullable().optional(),
});

function queryWorktreeId(url: URL): string | null {
  const value = url.searchParams.get("worktreeId");
  return value && value !== "main" ? value : null;
}

function asGitErrorResponse(e: unknown): Response {
  const payload = gitErrorPayload(e);
  return new Response(
    JSON.stringify({ error: payload.message, stderr: payload.stderr }),
    { status: HTTP_BAD_REQUEST, headers: { "content-type": "application/json" } },
  );
}

export async function status(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await getGitStatus(parsed.data, queryWorktreeId(url)));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function diff(rawId: string, url: URL): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const file = url.searchParams.get("file");
  if (!file) return jsonError(HTTP_BAD_REQUEST, "file is required");
  const stagedParam = url.searchParams.get("staged");
  const staged = stagedParam === "1" || stagedParam === "true";
  try {
    return json(await getGitDiff(idParsed.data, file, staged, queryWorktreeId(url)));
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
    await stageFiles(idParsed.data, parsed.data.files, parsed.data.worktreeId ?? null);
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
    await unstageFiles(idParsed.data, parsed.data.files, parsed.data.worktreeId ?? null);
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
    return json(await gitCommit(idParsed.data, {
      autoStage: parsed.data.autoStage,
      worktreeId: parsed.data.worktreeId ?? null,
    }));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function push(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const body = await parseJsonBody(request, z.object({ worktreeId: z.string().nullable().optional() }));
  if (!body.ok) return body.response;
  try {
    return json(await gitPush(parsed.data, body.data.worktreeId ?? null));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}
