import { deleteProjectFile } from "../services/git";
import { handleDomainError, idParam, json, jsonError, notFound } from "./_helpers";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";
import { normalizeWorktreeId } from "~/shared/worktrees";

export async function remove(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const filePath = url.searchParams.get("path");
  const worktreeId = normalizeWorktreeId(url.searchParams.get("worktreeId"));
  if (!filePath) return jsonError(HTTP_BAD_REQUEST, "path is required");
  try {
    await deleteProjectFile(parsed.data, filePath, worktreeId);
    return json({ ok: true });
  } catch (e: any) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    return jsonError(HTTP_BAD_REQUEST, e?.message || "delete failed");
  }
}
