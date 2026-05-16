import { z } from "zod";
import { deleteProjectFile } from "../services/git";
import { handleDomainError, json, jsonError, notFound } from "./_helpers";

const idParam = z.string().min(1);

export async function remove(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const filePath = url.searchParams.get("path");
  if (!filePath) return jsonError(400, "path is required");
  try {
    await deleteProjectFile(parsed.data, filePath);
    return json({ ok: true });
  } catch (e: any) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    return jsonError(400, e?.message || "delete failed");
  }
}
