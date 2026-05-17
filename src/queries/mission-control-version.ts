import { queryOptions, useQuery } from "@tanstack/react-query";
import { academyUrl } from "~/shared/academy";
import { isNewerSemver } from "~/shared/semver";

declare const __MC_VERSION__: string;

const DOWNLOADS_URL = academyUrl("/downloads");
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export const CURRENT_MC_VERSION: string =
  typeof __MC_VERSION__ !== "undefined" ? __MC_VERSION__ : "0.0.0";

type LatestRelease = {
  latestVersion: string | null;
  downloadUrl: string;
  isUpdateAvailable: boolean;
};

async function fetchLatest(): Promise<LatestRelease> {
  const url = academyUrl("/api/mission-control/releases?limit=1");
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
  staleTime: MS_PER_HOUR,
  gcTime: MS_PER_DAY,
  retry: 1,
  refetchOnWindowFocus: false,
});

export const useLatestMissionControlVersion = () =>
  useQuery(latestMissionControlVersionQueryOptions);
