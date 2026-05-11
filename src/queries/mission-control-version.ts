import { queryOptions, useQuery } from "@tanstack/react-query";
import { ACADEMY_BASE_URL } from "~/shared/academy";
import { isNewerSemver } from "~/shared/semver";

declare const __MC_VERSION__: string;

const DOWNLOADS_URL = `${ACADEMY_BASE_URL.replace(/\/$/, "")}/downloads`;

export const CURRENT_MC_VERSION: string =
  typeof __MC_VERSION__ !== "undefined" ? __MC_VERSION__ : "0.0.0";

type LatestRelease = {
  latestVersion: string | null;
  downloadUrl: string;
  isUpdateAvailable: boolean;
};

async function fetchLatest(): Promise<LatestRelease> {
  const url = `${ACADEMY_BASE_URL.replace(/\/$/, "")}/api/mission-control/releases?limit=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`mc-releases ${res.status}`);
  const body = (await res.json()) as { releases?: Array<{ version?: string }> };
  const raw = body.releases?.[0]?.version ?? null;
  const remote = raw ? raw.replace(/^v/i, "") : null;
  return {
    latestVersion: remote,
    downloadUrl: DOWNLOADS_URL,
    isUpdateAvailable: !!remote && isNewerSemver(remote, CURRENT_MC_VERSION),
  };
}

export const latestMissionControlVersionQueryOptions = queryOptions({
  queryKey: ["mission-control", "latest-version"] as const,
  queryFn: fetchLatest,
  staleTime: 60 * 60 * 1000, // 1h
  gcTime: 24 * 60 * 60 * 1000,
  retry: 1,
  refetchOnWindowFocus: false,
});

export const useLatestMissionControlVersion = () =>
  useQuery(latestMissionControlVersionQueryOptions);
