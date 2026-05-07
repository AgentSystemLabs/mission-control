// Thin renderer-side wrapper around the install-skills electron bridge.
import { getElectron } from "~/lib/electron";
import { ACADEMY_BASE_URL } from "~/shared/academy";
import type {
  InstallSkillsArgs,
  InstallSkillsResult,
  LatestSkillsManifest,
} from "~/shared/electron-contract";

// Renderer-side env override (Vite). Falls back to shared default.
const VITE_BASE = (import.meta as unknown as { env?: { VITE_ACADEMY_BASE_URL?: string } })
  .env?.VITE_ACADEMY_BASE_URL;
export const RENDERER_ACADEMY_BASE_URL = VITE_BASE ?? ACADEMY_BASE_URL;

export async function fetchLatestSkillsManifest(): Promise<LatestSkillsManifest> {
  const electron = getElectron();
  if (!electron) throw new Error("Install Skills requires the desktop app");
  const res = await electron.installSkills.fetchLatest(RENDERER_ACADEMY_BASE_URL);
  if (!res.ok) throw new Error(res.error);
  return res.manifest;
}

export async function runInstallSkills(
  args: Omit<InstallSkillsArgs, "baseUrl">,
): Promise<InstallSkillsResult> {
  const electron = getElectron();
  if (!electron) throw new Error("Install Skills requires the desktop app");
  const res = await electron.installSkills.run({
    ...args,
    baseUrl: RENDERER_ACADEMY_BASE_URL,
  });
  if (!res.ok) throw new Error(res.error);
  return res.result;
}
