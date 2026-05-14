import { createPostgresRepositories } from "./postgres";
import { createSqliteRepositories } from "./sqlite";
import { serverEnv } from "~/shared/env";
import type { AppRepositories } from "./types";

let cached: AppRepositories | null = null;
let override: AppRepositories | null = null;

export function getRepositories(): AppRepositories {
  if (override) return override;
  if (cached) return cached;
  const cloudMode = serverEnv().MC_CLOUD_MODE;
  const isCloud = cloudMode === "1" || cloudMode === "true" || cloudMode === "yes";
  cached = isCloud ? createPostgresRepositories() : createSqliteRepositories();
  return cached;
}

export function setRepositoriesForTests(repos: AppRepositories | null): void {
  override = repos;
  cached = null;
}

export function resetRepositoriesForTests(): void {
  override = null;
  cached = null;
}

export type { AppRepositories, UserScope } from "./types";
