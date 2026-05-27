import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Group } from "~/db/schema";
import type { AppSettings } from "~/lib/api";
import type { LicenseState } from "~/shared/license";
import type { ProjectWithCounts } from "~/shared/projects";

export const SHELL_QUERY_CACHE_VERSION = 1;

export const SHELL_QUERY_CACHE_KEYS = {
  projects: "mc:shell-cache:projects:v1",
  groups: "mc:shell-cache:groups:v1",
  settings: "mc:shell-cache:settings:v1",
  license: "mc:shell-cache:license:v1",
} as const;

type CacheEnvelope<T> = {
  version: typeof SHELL_QUERY_CACHE_VERSION;
  savedAt: number;
  data: T;
};

const installedClients = new WeakSet<QueryClient>();

function readCache<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>> | null;
    if (!parsed || parsed.version !== SHELL_QUERY_CACHE_VERSION) return undefined;
    return parsed.data as T;
  } catch {
    return undefined;
  }
}

function writeCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CacheEnvelope<T> = {
      version: SHELL_QUERY_CACHE_VERSION,
      savedAt: Date.now(),
      data,
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* localStorage unavailable */
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExactQueryKey(queryKey: QueryKey, key: string): boolean {
  return queryKey.length === 1 && queryKey[0] === key;
}

function hasPinnedProjects(projects: ProjectWithCounts[]): boolean {
  return projects.some((project) => project.pinned);
}

function syncPinnedProjectDocumentState(projects: ProjectWithCounts[]): void {
  if (typeof document === "undefined") return;
  document.documentElement.toggleAttribute(
    "data-has-pinned-projects",
    hasPinnedProjects(projects),
  );
}

export function readCachedProjects(): ProjectWithCounts[] | undefined {
  const data = readCache<unknown>(SHELL_QUERY_CACHE_KEYS.projects);
  return Array.isArray(data) ? (data as ProjectWithCounts[]) : undefined;
}

export function readCachedGroups(): Group[] | undefined {
  const data = readCache<unknown>(SHELL_QUERY_CACHE_KEYS.groups);
  return Array.isArray(data) ? (data as Group[]) : undefined;
}

export function readCachedSettings(): AppSettings | undefined {
  const data = readCache<unknown>(SHELL_QUERY_CACHE_KEYS.settings);
  return isObject(data) ? (data as AppSettings) : undefined;
}

export function readCachedLicense(): LicenseState | undefined {
  const data = readCache<unknown>(SHELL_QUERY_CACHE_KEYS.license);
  return isObject(data) ? (data as LicenseState) : undefined;
}

export function writeCachedProjects(projects: ProjectWithCounts[]): void {
  writeCache(SHELL_QUERY_CACHE_KEYS.projects, projects);
  syncPinnedProjectDocumentState(projects);
}

export function writeCachedGroups(groups: Group[]): void {
  writeCache(SHELL_QUERY_CACHE_KEYS.groups, groups);
}

export function writeCachedSettings(settings: AppSettings): void {
  writeCache(SHELL_QUERY_CACHE_KEYS.settings, settings);
}

export function writeCachedLicense(license: LicenseState): void {
  writeCache(SHELL_QUERY_CACHE_KEYS.license, license);
}

export function installShellQueryCache(queryClient: QueryClient): void {
  if (typeof window === "undefined" || installedClients.has(queryClient)) return;
  installedClients.add(queryClient);

  queryClient.getQueryCache().subscribe((event) => {
    const { query } = event;
    if (query.state.status !== "success") return;

    const { queryKey } = query;
    const { data } = query.state;

    if (isExactQueryKey(queryKey, "projects") && Array.isArray(data)) {
      writeCachedProjects(data as ProjectWithCounts[]);
      return;
    }

    if (isExactQueryKey(queryKey, "groups") && Array.isArray(data)) {
      writeCachedGroups(data as Group[]);
      return;
    }

    if (isExactQueryKey(queryKey, "settings") && isObject(data)) {
      writeCachedSettings(data as AppSettings);
      return;
    }

    if (isExactQueryKey(queryKey, "license") && isObject(data)) {
      writeCachedLicense(data as LicenseState);
    }
  });
}
