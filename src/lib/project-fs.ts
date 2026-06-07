// Routes the file browser / editor to the host filesystem (local Electron PTY
// runtime) or to the in-container clone over RPC (Docker sandbox runtime),
// behind one `(projectRoot, relPath)` interface. Defaults to host — when the
// Terminal runtime isn't "docker", every call is exactly the prior behavior.
import { sandboxWorkspacePath } from "~/shared/sandbox-workspace";
import { readSandboxRuntimeMode } from "~/lib/sandbox-runtime";
import type {
  FileListResult,
  FileReadResult,
  FileWriteResult,
} from "~/shared/electron-contract";

/** Container clone path for a project, derived from its host-dir basename. */
export function sandboxContainerRoot(projectRoot: string): string {
  return sandboxWorkspacePath(projectRoot.split("/").filter(Boolean).pop() ?? "project");
}

function containerPath(projectRoot: string, relPath: string): string {
  return `${sandboxContainerRoot(projectRoot)}/${relPath}`;
}

/** True when the Terminal runtime is the Docker sandbox (so fs/git go over RPC). */
export async function isSandboxRuntimeActive(): Promise<boolean> {
  return (await readSandboxRuntimeMode(window.electronAPI ?? null)) === "docker";
}

const useSandboxFs = isSandboxRuntimeActive;

const NOT_ELECTRON = { ok: false as const, error: "Not running in Electron" };

export async function listProjectFiles(projectRoot: string): Promise<FileListResult> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  return (await useSandboxFs())
    ? api.remoteFs.list(sandboxContainerRoot(projectRoot))
    : api.files.list(projectRoot);
}

export async function readProjectFile(
  projectRoot: string,
  relPath: string,
): Promise<FileReadResult> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  return (await useSandboxFs())
    ? api.remoteFs.read(containerPath(projectRoot, relPath))
    : api.files.read(projectRoot, relPath);
}

export async function writeProjectFile(
  projectRoot: string,
  relPath: string,
  content: string,
  expectedMtimeMs: number | null,
): Promise<FileWriteResult> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  return (await useSandboxFs())
    ? api.remoteFs.write(containerPath(projectRoot, relPath), content, expectedMtimeMs)
    : api.files.write(projectRoot, relPath, content, expectedMtimeMs);
}

/**
 * Host-only escalation: a protected-path write goes through the native confirm
 * dialog. The sandbox agent has no such dialog — it just enforces the deny-list —
 * so there the call is the same plain remote write (a protected path stays
 * refused).
 */
export async function writeProjectFileSensitive(
  projectRoot: string,
  relPath: string,
  content: string,
  expectedMtimeMs: number | null,
): Promise<FileWriteResult> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  return (await useSandboxFs())
    ? api.remoteFs.write(containerPath(projectRoot, relPath), content, expectedMtimeMs)
    : api.files.writeSensitive(projectRoot, relPath, content, expectedMtimeMs);
}

export type ProjectFileWatch = {
  watchId: string;
  /** Subscribe to change events for THIS watch (filter by watchId). Returns unsubscribe. */
  onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) => () => void;
  unwatch: () => void;
};

export async function watchProjectFile(
  projectRoot: string,
  relPath: string,
): Promise<{ ok: true; watch: ProjectFileWatch } | { ok: false; error: string }> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  if (await useSandboxFs()) {
    const r = await api.remoteFs.watch(containerPath(projectRoot, relPath));
    if (!r.ok) return r;
    return {
      ok: true,
      watch: {
        watchId: r.watchId,
        onChanged: (cb) => api.remoteFs.onChange((m) => cb({ watchId: m.watchId, mtimeMs: m.mtimeMs })),
        unwatch: () => void api.remoteFs.unwatch(r.watchId),
      },
    };
  }
  const r = await api.files.watch(projectRoot, relPath);
  if (!r.ok) return r;
  return {
    ok: true,
    watch: {
      watchId: r.watchId,
      onChanged: (cb) => api.files.onChanged(cb),
      unwatch: () => void api.files.unwatch(r.watchId),
    },
  };
}
