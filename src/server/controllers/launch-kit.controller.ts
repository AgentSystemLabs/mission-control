import { z } from "zod";
import { createProjectFromLaunchKit, readLaunchKitAccess } from "../services/launch-kit";
import { handleDomainError, json, jsonError, parseJsonBody } from "./_helpers";

const createProjectBody = z.object({
  parentDir: z.string().min(1, "parentDir is required"),
  projectName: z.string().min(1, "projectName is required"),
});

export async function access(): Promise<Response> {
  return json(await readLaunchKitAccess());
}

export async function create(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createProjectBody);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await createProjectFromLaunchKit(parsed.data);
    return json(result, { status: 201 });
  } catch (e: any) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    return jsonError(400, e?.message ?? "Launch Kit import failed");
  }
}
