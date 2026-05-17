import { useSyncExternalStore } from "react";

// Structural mirror of UpdateStateBridge in electron/preload.ts plus a renderer-
// local `priming` state that distinguishes "haven't heard from main yet" from
// "main reported idle". We don't import from electron/ to keep the renderer
// bundle free of main-process modules; drift between the two is caught by the
// reviewer-contracts subagent.
export type UpdateState =
  | { kind: "priming" }
  | { kind: "unsupported-dev" }
  | { kind: "idle"; lastCheckedAt: number | null }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | {
      kind: "downloading";
      version: string;
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { kind: "ready-to-install"; version: string }
  | { kind: "error"; message: string };

type UpdaterAPI = {
  getState: () => Promise<UpdateState>;
  check: () => Promise<void>;
  download: () => Promise<{ ok: true } | { ok: false; error: string }>;
  installNow: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onStateChange: (cb: (state: UpdateState) => void) => () => void;
};

function getUpdater(): UpdaterAPI | null {
  if (typeof window === "undefined") return null;
  const api = (window as any).electronAPI as { updater?: UpdaterAPI } | undefined;
  return api?.updater ?? null;
}

type Snapshot = UpdateState;

// Module-level store so every component reads the same liveness signal and we only
// subscribe once across the whole renderer. SSR is impossible in Electron so we
// don't bother with a server snapshot.
const PRIMING: Snapshot = { kind: "priming" };
let snapshot: Snapshot = PRIMING;
const listeners = new Set<() => void>();
let primed = false;
let primeInFlight = false;

function emit() {
  for (const l of listeners) l();
}

function setSnapshot(next: Snapshot) {
  snapshot = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Lazily prime + subscribe to main once the first consumer mounts.
  if (!primed && !primeInFlight) {
    primeInFlight = true;
    const api = getUpdater();
    if (!api) {
      // Renderer running outside Electron (web preview, tests): pin to unsupported-dev
      // so the UI hides the button.
      setSnapshot({ kind: "unsupported-dev" });
      primed = true;
      primeInFlight = false;
    } else {
      // Subscribe BEFORE getState so any state change that fires between prime
      // and subscription isn't lost. The reducer below ignores incoming
      // priming|stale events that the late getState() would resolve to anyway.
      api.onStateChange((s) => setSnapshot(s));
      void api
        .getState()
        .then((s) => {
          // Only overwrite with the prime result if a live event hasn't already
          // moved us off priming — otherwise we'd flicker a fresh `checking`
          // back to `idle`.
          if (snapshot.kind === "priming") setSnapshot(s);
        })
        .catch((err) => {
          console.error("[updater] getState failed:", err);
          setSnapshot({ kind: "error", message: "failed to read update state" });
        })
        .finally(() => {
          primed = true;
          primeInFlight = false;
        });
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

export function useAutoUpdaterState(): UpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export async function triggerUpdateCheck(): Promise<void> {
  const api = getUpdater();
  if (!api) return;
  await api.check();
}

export async function triggerUpdateInstall(): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = getUpdater();
  if (!api) return { ok: false, error: "not-electron" };
  return api.installNow();
}
