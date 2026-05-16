import { z } from "zod";
import {
  fetchLatestSkillsManifest,
  installProjectSkills,
  readInstalledSkillsVersion,
} from "../services/install-skills";
import { handleDomainError, json, jsonError, parseJsonBody } from "./_helpers";

const installBody = z.object({
  projectPath: z.string().min(1, "projectPath is required"),
  harnesses: z
    .object({
      claude: z.boolean().optional(),
      codex: z.boolean().optional(),
    })
    .optional()
    .default({}),
});

export function installed(url: URL): Response {
  const projectPath = url.searchParams.get("projectPath") ?? "";
  return json({ installed: readInstalledSkillsVersion(projectPath) });
}

export async function latest(): Promise<Response> {
  try {
    const manifest = await fetchLatestSkillsManifest();
    return json({ manifest });
  } catch (e: any) {
    return jsonError(502, e?.message ?? "Failed to fetch manifest");
  }
}

export async function install(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, installBody);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await installProjectSkills({
      projectPath: parsed.data.projectPath,
      harnesses: {
        claude: !!parsed.data.harnesses?.claude,
        codex: !!parsed.data.harnesses?.codex,
      },
    });
    return json({ result });
  } catch (e: any) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    return jsonError(400, e?.message ?? "Install failed");
  }
}
