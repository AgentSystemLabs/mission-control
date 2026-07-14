// Drop positions for remote (peer) pets. Kept outside React so project switches,
// focus-mode unmounts, and full reloads don't teleport peers back to the
// default cluster. Keyed by ephemeral peer id — stable for as long as that
// peer's app session stays open.

const STORAGE_KEY = "mc-remote-pet-anchors";
const MAX_ENTRIES = 200;

type AnchorEntry = { x: number; at: number };

let cache: Map<string, AnchorEntry> | null = null;

function readStorage(): Map<string, AnchorEntry> {
  const map = new Map<string, AnchorEntry>();
  if (typeof window === "undefined") return map;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return map;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return map;
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!id || typeof id !== "string") continue;
      const entry = sanitizeEntry(value);
      if (entry) map.set(id.slice(0, 64), entry);
    }
  } catch {
    /* quota / disabled / malformed — start empty */
  }
  return map;
}

function sanitizeEntry(value: unknown): AnchorEntry | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as { x?: unknown; at?: unknown };
  if (typeof rec.x !== "number" || !Number.isFinite(rec.x)) return null;
  const at =
    typeof rec.at === "number" && Number.isFinite(rec.at) ? Math.floor(rec.at) : Date.now();
  return { x: Math.round(rec.x), at };
}

function ensureCache(): Map<string, AnchorEntry> {
  if (!cache) cache = readStorage();
  return cache;
}

function persist(map: Map<string, AnchorEntry>): void {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, AnchorEntry> = {};
    for (const [id, entry] of map) obj[id] = entry;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota or disabled */
  }
}

function prune(map: Map<string, AnchorEntry>): void {
  if (map.size <= MAX_ENTRIES) return;
  const ranked = [...map.entries()].sort((a, b) => a[1].at - b[1].at);
  const drop = ranked.length - MAX_ENTRIES;
  for (let i = 0; i < drop; i++) {
    const id = ranked[i]?.[0];
    if (id) map.delete(id);
  }
}

/** Last drop X for a peer, or undefined if we've never parked them. */
export function getPeerAnchorX(peerId: string): number | undefined {
  return ensureCache().get(peerId)?.x;
}

/** Remember a peer's drop point across project switches and reloads. */
export function setPeerAnchorX(peerId: string, x: number): void {
  if (!peerId || !Number.isFinite(x)) return;
  const map = ensureCache();
  map.set(peerId.slice(0, 64), { x: Math.round(x), at: Date.now() });
  prune(map);
  persist(map);
}

/** Test-only: wipe in-memory + storage state. */
export function __resetPeerAnchorsForTests(): void {
  cache = null;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
