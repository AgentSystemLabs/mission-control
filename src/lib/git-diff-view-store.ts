import { useCallback, useSyncExternalStore } from "react";
import { readJson, writeJson } from "./local-storage-json";

export type GitDiffViewOpenByProject = Record<string, boolean>;

const STORAGE_KEY = "mc.gitDiffViewOpenByProject";

const listeners = new Set<() => void>();

function normalizeGitDiffViewOpenByProject(value: unknown): GitDiffViewOpenByProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: GitDiffViewOpenByProject = {};
  for (const [projectId, open] of Object.entries(value)) {
    if (typeof projectId !== "string" || !projectId.trim()) continue;
    if (open === true) next[projectId] = true;
  }
  return next;
}

function loadGitDiffViewOpenByProject(): GitDiffViewOpenByProject {
  return normalizeGitDiffViewOpenByProject(readJson<unknown>(STORAGE_KEY, {}));
}

function saveGitDiffViewOpenByProject(next: GitDiffViewOpenByProject): void {
  writeJson(STORAGE_KEY, next);
}

let snapshot: GitDiffViewOpenByProject = loadGitDiffViewOpenByProject();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function isGitDiffViewOpen(projectId: string): boolean {
  return snapshot[projectId] === true;
}

export function setGitDiffViewOpen(projectId: string, open: boolean): void {
  if (open) {
    if (snapshot[projectId] === true) return;
    snapshot = { ...snapshot, [projectId]: true };
  } else if (snapshot[projectId] === true) {
    const { [projectId]: _removed, ...rest } = snapshot;
    snapshot = rest;
  } else {
    return;
  }
  saveGitDiffViewOpenByProject(snapshot);
  emit();
}

export function toggleGitDiffViewOpen(projectId: string): void {
  setGitDiffViewOpen(projectId, !isGitDiffViewOpen(projectId));
}

export function useGitDiffViewOpen(projectId: string) {
  const byProject = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const open = byProject[projectId] === true;

  const toggle = useCallback(() => {
    toggleGitDiffViewOpen(projectId);
  }, [projectId]);

  const close = useCallback(() => {
    setGitDiffViewOpen(projectId, false);
  }, [projectId]);

  const setOpen = useCallback(
    (next: boolean) => {
      setGitDiffViewOpen(projectId, next);
    },
    [projectId],
  );

  return { open, toggle, close, setOpen };
}
