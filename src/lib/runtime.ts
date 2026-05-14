import type { RuntimeBridge } from "~/shared/runtime-contract";
import { apiErrorCode, isApiErrorEnvelope } from "~/shared/api-errors";

declare global {
  interface Window {
    electronAPI?: RuntimeBridge;
  }
}

type RuntimeEvent =
  | { type: "pty:data"; ptyId: string; data: string }
  | { type: "pty:exit"; ptyId: string; exitCode: number; signal?: number }
  | { type: "files:changed"; watchId: string; mtimeMs: number };

const ptyDataListeners = new Set<(msg: { ptyId: string; data: string }) => void>();
const ptyExitListeners = new Set<(msg: { ptyId: string; exitCode: number; signal?: number }) => void>();
const fileChangedListeners = new Set<(msg: { watchId: string; mtimeMs: number }) => void>();

let eventSource: EventSource | null = null;
let runtimeToken: string | null | undefined;
let runtimeTokenPromise: Promise<string | null> | null = null;
let runtimeMode: "cloud" | "local" | undefined;

export class RuntimeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly code: string | null = apiErrorCode(body),
    public readonly details: unknown = isApiErrorEnvelope(body) ? body.details : null,
  ) {
    super(message);
    this.name = "RuntimeApiError";
  }
}

function emitRuntimeEvent(event: RuntimeEvent) {
  if (event.type === "pty:data") {
    for (const cb of ptyDataListeners) cb({ ptyId: event.ptyId, data: event.data });
  } else if (event.type === "pty:exit") {
    for (const cb of ptyExitListeners) cb({
      ptyId: event.ptyId,
      exitCode: event.exitCode,
      signal: event.signal,
    });
  } else if (event.type === "files:changed") {
    for (const cb of fileChangedListeners) cb({ watchId: event.watchId, mtimeMs: event.mtimeMs });
  }
}

function ensureEventSource() {
  if (typeof window === "undefined" || eventSource) return;
  eventSource = new EventSource("/api/runtime/events", { withCredentials: true });
  eventSource.onmessage = (msg) => {
    try {
      emitRuntimeEvent(JSON.parse(msg.data) as RuntimeEvent);
    } catch {
      /* ignore malformed runtime events */
    }
  };
  eventSource.onerror = () => {
    // EventSource retries automatically; keep listeners attached across
    // transient network drops instead of silently disabling runtime updates.
  };
}

function clearRuntimeTokenCache(): void {
  runtimeToken = undefined;
  runtimeTokenPromise = null;
}

async function getRuntimeClientToken(): Promise<string | null> {
  if (runtimeToken !== undefined) return runtimeToken;
  if (runtimeTokenPromise) return runtimeTokenPromise;
  runtimeTokenPromise = fetch("/api/runtime/client-token", {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) {
        runtimeToken = null;
        return null;
      }
      const body = (await res.json().catch(() => ({}))) as { token?: unknown };
      const token = typeof body.token === "string" ? body.token.trim() : "";
      runtimeToken = token || null;
      return runtimeToken;
    })
    .catch(() => {
      runtimeToken = null;
      return null;
    })
    .finally(() => {
      runtimeTokenPromise = null;
    });
  return runtimeTokenPromise;
}

async function runtimeReq<T>(
  path: string,
  init?: RequestInit,
  opts?: { auth?: boolean },
): Promise<T> {
  const incomingHeaders = (init?.headers as Record<string, string> | undefined) ?? {};
  const hasAuth = Object.keys(incomingHeaders).some(
    (key) => key.toLowerCase() === "authorization",
  );
  const shouldAuth = opts?.auth !== false && !hasAuth;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...incomingHeaders,
  };
  const token = shouldAuth ? await getRuntimeClientToken() : null;
  if (token) headers.authorization = `Bearer ${token}`;
  let res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  if (res.status === 401 && shouldAuth && token) {
    clearRuntimeTokenCache();
    const retryToken = await getRuntimeClientToken();
    if (retryToken && retryToken !== token) {
      res = await fetch(path, {
        credentials: "same-origin",
        ...init,
        headers: {
          ...headers,
          authorization: `Bearer ${retryToken}`,
        },
      });
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown;
    let message = "Request failed";
    try {
      body = JSON.parse(text) as unknown;
      if (isApiErrorEnvelope(body)) {
        message = body.error;
      } else {
        message = `${res.status} ${res.statusText}`;
      }
    } catch {
      body = text ? { error: "Request failed" } : null;
    }
    throw new RuntimeApiError(message, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function unsupported<T>(message = "Not supported in the cloud runtime"): Promise<T> {
  return Promise.reject(new Error(message));
}

function localElectronRuntime(electron: RuntimeBridge): RuntimeBridge {
  return {
    ...electron,
    hostKind: "desktop",
    getApiBaseUrl:
      electron.getApiBaseUrl ??
      (async () => {
        const port = await electron.getRuntimePort();
        return port ? `http://127.0.0.1:${port}` : null;
      }),
  };
}

function isElectronHostWithoutBridge(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & {
    navigator?: { userAgent?: string };
    location?: { protocol?: string };
  };
  const userAgent =
    w.navigator?.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  return /\bElectron\//.test(userAgent) || w.location?.protocol === "app:";
}

function cloudRuntime(): RuntimeBridge {
  return {
    hostKind: "cloud",
    installSkills: {
      fetchLatest: () => unsupported("Skill bundle install is not available from the cloud browser host yet."),
      run: () => unsupported("Skill bundle install is not available from the cloud browser host yet."),
    },
    getPathForFile: () => "",
    browseFolder: async () => null,
    pickProjectParentDir: async () => null,
    openPath: async () => ({ ok: false as const, error: "not-supported" }),
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true as const };
    },
    pickImage: async () => null,
    saveProjectImage: async () => ({ error: "not-supported" }),
    getRuntimePort: async () => null,
    getApiBaseUrl: async () => window.location.origin,
    getApiToken: async () => {
      const result = await runtimeReq<{ token: string | null }>(
        "/api/runtime/client-token",
        undefined,
        { auth: false },
      ).catch(() => ({ token: null }));
      return result.token;
    },
    getUserDataDir: async () => "",
    getUserName: async () => {
      const result = await runtimeReq<{ fullName: string; firstName: string }>("/api/runtime/user").catch(() => ({
        fullName: "User",
        firstName: "User",
      }));
      return { source: "os" as const, ...result };
    },
    cliCheck: async (command) =>
      runtimeReq<{ ok: true; path: string } | { ok: false; reason: string }>("/api/runtime/cli-check", {
        method: "POST",
        body: JSON.stringify({ command }),
      }),
    getProjectPath: async (projectId) =>
      runtimeReq<{ ok: true; path: string } | { ok: false; error: string }>("/api/runtime/projects/path", {
        method: "POST",
        body: JSON.stringify({ projectId }),
      }),
    pty: {
      spawn: (opts) =>
        runtimeReq<{ ptyId: string }>("/api/runtime/pty/spawn", {
          method: "POST",
          body: JSON.stringify(opts),
        }),
      write: (ptyId, data, projectId) =>
        runtimeReq<{ ok: boolean }>("/api/runtime/pty/write", {
          method: "POST",
          body: JSON.stringify({ ptyId, data, projectId }),
        }).then((r) => r.ok),
      resize: (ptyId, cols, rows) =>
        runtimeReq<{ ok: boolean }>("/api/runtime/pty/resize", {
          method: "POST",
          body: JSON.stringify({ ptyId, cols, rows }),
        }).then((r) => r.ok),
      kill: (ptyId) =>
        runtimeReq<{ ok: boolean }>("/api/runtime/pty/kill", {
          method: "POST",
          body: JSON.stringify({ ptyId }),
        }).then((r) => r.ok),
      killLaunchProcesses: (opts) =>
        runtimeReq("/api/runtime/pty/kill-launch-processes", {
          method: "POST",
          body: JSON.stringify(opts),
        }),
      onData: (cb) => {
        ensureEventSource();
        ptyDataListeners.add(cb);
        return () => ptyDataListeners.delete(cb);
      },
      onExit: (cb) => {
        ensureEventSource();
        ptyExitListeners.add(cb);
        return () => ptyExitListeners.delete(cb);
      },
      replay: (ptyId) =>
        runtimeReq<{ data: string }>("/api/runtime/pty/replay", {
          method: "POST",
          body: JSON.stringify({ ptyId }),
        }).then((r) => r.data),
    },
    onSwipe: () => () => undefined,
    isFullScreen: async () => false,
    onFullScreenChange: () => () => undefined,
    onCloseIntent: () => () => undefined,
    onAgentHooksInstallFailed: () => () => undefined,
    files: {
      list: (projectId) =>
        runtimeReq("/api/runtime/files/list", {
          method: "POST",
          body: JSON.stringify({ projectId }),
        }),
      read: (projectId, relPath) =>
        runtimeReq("/api/runtime/files/read", {
          method: "POST",
          body: JSON.stringify({ projectId, relPath }),
        }),
      write: (projectId, relPath, content, expectedMtimeMs) =>
        runtimeReq("/api/runtime/files/write", {
          method: "POST",
          body: JSON.stringify({ projectId, relPath, content, expectedMtimeMs }),
        }),
      watch: (projectId, relPath) =>
        runtimeReq("/api/runtime/files/watch", {
          method: "POST",
          body: JSON.stringify({ projectId, relPath }),
        }),
      unwatch: (watchId) =>
        runtimeReq("/api/runtime/files/unwatch", {
          method: "POST",
          body: JSON.stringify({ watchId }),
        }),
      onChanged: (cb) => {
        ensureEventSource();
        fileChangedListeners.add(cb);
        return () => fileChangedListeners.delete(cb);
      },
    },
  };
}

let cachedRuntime: RuntimeBridge | null | undefined;

export function setRuntimeMode(cloudMode: boolean): void {
  const nextMode = cloudMode ? "cloud" : "local";
  if (runtimeMode === nextMode) return;
  runtimeMode = nextMode;
  // A local browser tab initially looks like the cloud host until the mode
  // probe resolves. Recompute once the server tells us which host we are in.
  cachedRuntime = undefined;
}

export function getRuntime(): RuntimeBridge | null {
  if (typeof window === "undefined") return null;
  if (cachedRuntime !== undefined) return cachedRuntime;
  if (window.electronAPI) {
    cachedRuntime = localElectronRuntime(window.electronAPI);
  } else if (isElectronHostWithoutBridge()) {
    cachedRuntime = null;
  } else if (runtimeMode === "local") {
    cachedRuntime = null;
  } else {
    cachedRuntime = cloudRuntime();
  }
  return cachedRuntime;
}

export function isRuntimeAvailable(): boolean {
  return getRuntime() !== null;
}
