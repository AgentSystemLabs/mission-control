// Renderer-side wrapper for the install-skills HTTP API.
// The local mission-control server resolves ACADEMY_BASE_URL itself
// (localhost:3000 in dev, https://agentsystem.dev in prod), so no env var is
// required from the user.
import { DEV_SERVER_ORIGIN } from "~/shared/dev-server";
import { resolveApiToken } from "~/lib/api";
import type {
  InstallSkillsResult,
  LatestSkillsManifest,
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

export type InstalledSkillsVersion = {
  version: string | null;
  publishedAt: string | null;
};

export async function fetchInstalledSkillsVersion(
  projectPath: string,
): Promise<InstalledSkillsVersion> {
  const { installed } = await req<{ installed: InstalledSkillsVersion }>(
    `/api/skills/install/installed?projectPath=${encodeURIComponent(projectPath)}`,
  );
  return installed;
}

export async function fetchLatestSkillsManifest(): Promise<LatestSkillsManifest> {
  const { manifest } = await req<{ manifest: LatestSkillsManifest }>(
    "/api/skills/install/latest",
  );
  return manifest;
}

export async function runInstallSkills(args: {
  projectPath: string;
  harnesses: { claude: boolean; codex: boolean };
}): Promise<InstallSkillsResult> {
  const { result } = await req<{ result: InstallSkillsResult }>(
    "/api/skills/install",
    { method: "POST", body: JSON.stringify(args) },
  );
  return result;
}
