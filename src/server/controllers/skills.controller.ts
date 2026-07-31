import { z } from "zod";
import {
  installDiagramSkill,
  readDiagramSkillInstallStatus,
} from "../services/install-diagram-skill";
import {
  installShipSkills,
  readShipSkillInstallStatus,
} from "../services/install-ship-skills";
import { handleDomainError, json, jsonError, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";

const diagramHarnessSelectionBody = z
  .object({
    claude: z.boolean().optional(),
    codex: z.boolean().optional(),
    grok: z.boolean().optional(),
    cursor: z.boolean().optional(),
  })
  .optional()
  .default({});

const shipHarnessSelectionBody = z
  .object({
    claude: z.boolean().optional(),
    codex: z.boolean().optional(),
    cursor: z.boolean().optional(),
  })
  .optional()
  .default({});

const diagramInstallBody = z.object({
  projectPath: z.string().min(1, "projectPath is required"),
  harnesses: diagramHarnessSelectionBody,
});

const shipInstallBody = z.object({
  projectPath: z.string().min(1, "projectPath is required"),
  harnesses: shipHarnessSelectionBody,
});

export function diagramInstalled(url: URL): Response {
  const projectPath = url.searchParams.get("projectPath") ?? "";
  return json({ installed: readDiagramSkillInstallStatus(projectPath) });
}

export async function installDiagram(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, diagramInstallBody);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await installDiagramSkill({
      projectPath: parsed.data.projectPath,
      harnesses: {
        claude: !!parsed.data.harnesses?.claude,
        codex: !!parsed.data.harnesses?.codex,
        grok: !!parsed.data.harnesses?.grok,
        cursor: !!parsed.data.harnesses?.cursor,
      },
    });
    return json({ result });
  } catch (e: any) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    return jsonError(HTTP_BAD_REQUEST, e?.message ?? "Install failed");
  }
}

export function shipInstalled(url: URL): Response {
  const projectPath = url.searchParams.get("projectPath") ?? "";
  return json({ installed: readShipSkillInstallStatus(projectPath) });
}

export async function installShip(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, shipInstallBody);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await installShipSkills({
      projectPath: parsed.data.projectPath,
      harnesses: {
        claude: !!parsed.data.harnesses?.claude,
        codex: !!parsed.data.harnesses?.codex,
        cursor: !!parsed.data.harnesses?.cursor,
      },
    });
    return json({ result });
  } catch (e: any) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    return jsonError(HTTP_BAD_REQUEST, e?.message ?? "Install failed");
  }
}
