// Renderer-side wrapper for bundled skill install HTTP APIs.
import { DEV_SERVER_ORIGIN } from "~/shared/dev-server";
import { resolveApiToken } from "~/lib/api";
import type { DiagramSkillHarnessSelection } from "~/shared/diagram-skill-install";
import type { ShipSkillHarnessSelection } from "~/shared/ship-skill-install";
import type {
  InstallDiagramSkillResult,
  InstallShipSkillsResult,
} from "~/shared/electron-contract";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const resolved =
    typeof window === "undefined" && url.startsWith("/")
      ? DEV_SERVER_ORIGIN + url
      : url;
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = await resolveApiToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(resolved, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchDiagramSkillInstallStatus(
  projectPath: string,
): Promise<InstallDiagramSkillResult> {
  const { installed } = await req<{ installed: InstallDiagramSkillResult }>(
    `/api/skills/install/diagram/installed?projectPath=${encodeURIComponent(projectPath)}`,
  );
  return installed;
}

export async function runInstallDiagramSkill(args: {
  projectPath: string;
  harnesses: DiagramSkillHarnessSelection;
}): Promise<InstallDiagramSkillResult> {
  const { result } = await req<{ result: InstallDiagramSkillResult }>(
    "/api/skills/install/diagram",
    { method: "POST", body: JSON.stringify(args) },
  );
  return result;
}

export async function fetchShipSkillInstallStatus(
  projectPath: string,
): Promise<InstallShipSkillsResult> {
  const { installed } = await req<{ installed: InstallShipSkillsResult }>(
    `/api/skills/install/ship/installed?projectPath=${encodeURIComponent(projectPath)}`,
  );
  return installed;
}

export async function runInstallShipSkills(args: {
  projectPath: string;
  harnesses: ShipSkillHarnessSelection;
}): Promise<InstallShipSkillsResult> {
  const { result } = await req<{ result: InstallShipSkillsResult }>(
    "/api/skills/install/ship",
    { method: "POST", body: JSON.stringify(args) },
  );
  return result;
}
