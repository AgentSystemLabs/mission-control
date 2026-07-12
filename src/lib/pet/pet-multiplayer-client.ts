// Singleton client for the "multiplayer pets" relay. One WebSocket per app,
// driven declaratively: callers describe the DESIRED state (am I enabled? which
// rooms do I broadcast to? which room am I viewing?) via setDesired(), and this
// module reconciles the live socket to match — connecting, subscribing,
// announcing presence, and reconnecting with backoff.
//
// Hard rules this module upholds:
//   * No socket is EVER opened unless desired.enabled is true.
//   * Every socket operation is wrapped so a dead/unreachable relay can only
//     ever result in "no remote pets" — never a thrown error into React.
//   * The only bytes sent are an ephemeral peer id, a pet species, a pet
//     name, level/prestige cosmetics, and the owner's accent color id,
//     addressed to opaque hashed rooms. No identity, repo, or path.

import {
  DEFAULT_PET_ACCENT,
  isPetAccentId,
  PET_WS_HEARTBEAT_MS,
  type PetClientMessage,
  type PetPeer,
  type PetServerMessage,
} from "~/shared/pet-multiplayer-protocol";

/** Ephemeral, per-app-session id. Not tied to any user/account/device. */
const PEER_ID = safeRandomId();

export type LocalPet = {
  species: PetPeer["species"];
  name: string;
  /** Earned-gear level and molt count — the cosmetic style peers should see. */
  level: number;
  prestige: number;
  /** Owner's accent so peers paint the sprite in the same theme color. */
  accent: PetPeer["accent"];
};

export type PetMultiplayerDesired = {
  enabled: boolean;
  wsUrl: string;
  /** My pet, or null when the pet system is off (then we can't broadcast). */
  localPet: LocalPet | null;
  /** Hashed rooms I should announce my pet in (repos with running sessions). */
  broadcastRooms: string[];
  /** Hashed room I'm currently looking at (listen even without a session). */
  viewRoom: string | null;
};

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// If the socket doesn't reach OPEN within this window, treat it as failed so a
// black-holed handshake can't wedge `connecting=true` forever.
const CONNECT_TIMEOUT_MS = 10_000;
// Defense-in-depth against a hostile/buggy relay: bound what we hold + render.
const MAX_PEERS_PER_ROOM = 200;
const MAX_NAME_LEN = 40;
// Mirror the relay's cosmetic ceilings; a malformed/absent value renders a
// bare, gear-less pet rather than throwing off the sprite.
const MAX_LEVEL = 100;
const MAX_PRESTIGE = 9_999;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function clampPeer(p: PetPeer): PetPeer {
  return {
    id: String(p.id).slice(0, 64),
    species: p.species,
    name: String(p.name ?? "").slice(0, MAX_NAME_LEN),
    level: clampInt(p.level, 1, MAX_LEVEL, 1),
    prestige: clampInt(p.prestige, 0, MAX_PRESTIGE, 0),
    accent: isPetAccentId(p.accent) ? p.accent : DEFAULT_PET_ACCENT,
  };
}

let desired: PetMultiplayerDesired = {
  enabled: false,
  wsUrl: "",
  localPet: null,
  broadcastRooms: [],
  viewRoom: null,
};

let ws: WebSocket | null = null;
let connecting = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = RECONNECT_MIN_MS;

// Live-connection tracking so reconcile only sends deltas.
const subscribedRooms = new Set<string>();
const announcedRooms = new Set<string>();
let announcedPetKey = "";

// room -> (peerId -> peer). Excludes our own PEER_ID defensively.
const rosters = new Map<string, Map<string, PetPeer>>();
const rosterListeners = new Map<string, Set<() => void>>();
// Cached, referentially-stable snapshot arrays per room. Rebuilt only when a
// room actually changes so useSyncExternalStore sees a stable identity between
// mutations (returning a fresh array every getSnapshot would loop forever).
const snapshots = new Map<string, PetPeer[]>();
const EMPTY_PEERS: PetPeer[] = [];

function safeRandomId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  } catch {
    return `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

function petKey(pet: LocalPet | null): string {
  return pet ? `${pet.species}|${pet.name}|${pet.level}|${pet.prestige}|${pet.accent}` : "";
}

/** The wire peer for our local pet — the single place presence is shaped. */
function localPeer(pet: LocalPet): PetPeer {
  return {
    id: PEER_ID,
    species: pet.species,
    name: pet.name,
    level: pet.level,
    prestige: pet.prestige,
    accent: pet.accent,
  };
}

function isActive(): boolean {
  // Connect whenever the feature is enabled (and there's a URL) — the socket
  // opens as soon as the user opts in, so the connection is visible/testable
  // immediately. It only actually subscribes/broadcasts once a room exists
  // (a viewed project or a running session); with none it just idles.
  return desired.enabled && !!desired.wsUrl;
}

function targetSubRooms(): Set<string> {
  const set = new Set<string>(desired.broadcastRooms);
  if (desired.viewRoom) set.add(desired.viewRoom);
  return set;
}

function targetBroadcastRooms(): Set<string> {
  // Can only announce a pet if we actually have one.
  return desired.localPet ? new Set(desired.broadcastRooms) : new Set();
}

// Rebuild the cached snapshot for a room, then fan out to listeners.
function commit(room: string): void {
  const map = rosters.get(room);
  snapshots.set(room, map && map.size ? [...map.values()] : EMPTY_PEERS);
  const ls = rosterListeners.get(room);
  if (!ls) return;
  for (const cb of ls) {
    try {
      cb();
    } catch {
      /* a listener throwing must not break the fan-out */
    }
  }
}

function setRoom(room: string, peers: PetPeer[]): void {
  const map = new Map<string, PetPeer>();
  for (const p of peers) {
    if (p.id !== PEER_ID && map.size < MAX_PEERS_PER_ROOM) map.set(p.id, clampPeer(p));
  }
  rosters.set(room, map);
  commit(room);
}

function send(msg: PetClientMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket is going away; reconnect will re-sync */
  }
}

function handleServerMessage(raw: unknown): void {
  let msg: PetServerMessage;
  try {
    msg = JSON.parse(String(raw)) as PetServerMessage;
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "roster":
      if (typeof msg.room === "string" && Array.isArray(msg.peers)) setRoom(msg.room, msg.peers);
      break;
    case "join": {
      if (typeof msg.room !== "string" || !msg.peer || msg.peer.id === PEER_ID) break;
      const map = rosters.get(msg.room) ?? new Map<string, PetPeer>();
      if (map.size >= MAX_PEERS_PER_ROOM && !map.has(msg.peer.id)) break;
      map.set(msg.peer.id, clampPeer(msg.peer));
      rosters.set(msg.room, map);
      commit(msg.room);
      break;
    }
    case "leave": {
      if (typeof msg.room !== "string" || typeof msg.peerId !== "string") break;
      const map = rosters.get(msg.room);
      if (map?.delete(msg.peerId)) commit(msg.room);
      break;
    }
    default:
      break;
  }
}

function reconcile(): void {
  if (!isActive()) {
    teardown();
    return;
  }
  if (!ws && !connecting) {
    connect();
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN) applySubscriptions();
}

function applySubscriptions(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const subs = targetSubRooms();
  const broadcast = targetBroadcastRooms();
  const petChanged = announcedPetKey !== petKey(desired.localPet);

  // Drop rooms we no longer care about.
  for (const room of [...subscribedRooms]) {
    if (!subs.has(room)) {
      send({ type: "unsub", room });
      subscribedRooms.delete(room);
      announcedRooms.delete(room);
      rosters.delete(room);
      commit(room);
    }
  }
  // Subscribe to new rooms.
  for (const room of subs) {
    if (!subscribedRooms.has(room)) {
      send({ type: "sub", room });
      subscribedRooms.add(room);
    }
  }
  // Stop broadcasting where we shouldn't.
  for (const room of [...announcedRooms]) {
    if (!broadcast.has(room)) {
      send({ type: "bye", room, peerId: PEER_ID });
      announcedRooms.delete(room);
    }
  }
  // Announce / refresh presence where we should.
  if (desired.localPet) {
    const peer = localPeer(desired.localPet);
    for (const room of broadcast) {
      if (!announcedRooms.has(room) || petChanged) {
        send({ type: "presence", room, peer });
        announcedRooms.add(room);
      }
    }
  }
  announcedPetKey = petKey(desired.localPet);
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!desired.localPet || !ws || ws.readyState !== WebSocket.OPEN) return;
    const peer = localPeer(desired.localPet);
    for (const room of announcedRooms) send({ type: "presence", room, peer });
  }, PET_WS_HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function connect(): void {
  if (ws || connecting || !isActive()) return;
  connecting = true;
  let sock: WebSocket;
  try {
    sock = new WebSocket(desired.wsUrl);
  } catch {
    connecting = false;
    scheduleReconnect();
    return;
  }
  ws = sock;
  // Guard against a handshake that never opens or closes.
  clearConnectTimer();
  connectTimer = setTimeout(() => {
    connectTimer = null;
    if (ws === sock && sock.readyState !== WebSocket.OPEN) {
      // Force it through the normal failure path (nulls handlers, reconnects).
      try {
        sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
        sock.close();
      } catch {
        /* ignore */
      }
      ws = null;
      connecting = false;
      if (isActive()) scheduleReconnect();
    }
  }, CONNECT_TIMEOUT_MS);
  sock.onopen = () => {
    if (ws !== sock) return; // a stale socket must not touch shared state
    clearConnectTimer();
    connecting = false;
    backoffMs = RECONNECT_MIN_MS;
    // Fresh socket: forget prior live state so applySubscriptions re-sends all.
    subscribedRooms.clear();
    announcedRooms.clear();
    announcedPetKey = "";
    try {
      applySubscriptions();
    } catch {
      /* never let a reconcile bug bubble out of the socket callback */
    }
    startHeartbeat();
  };
  sock.onmessage = (ev) => {
    if (ws !== sock) return;
    try {
      handleServerMessage((ev as MessageEvent).data);
    } catch {
      /* ignore malformed frames */
    }
  };
  sock.onerror = () => {
    // An error is always followed by close; handle cleanup there.
  };
  sock.onclose = () => {
    if (ws !== sock) return; // stale socket's close is a no-op
    ws = null;
    clearConnectTimer();
    connecting = false;
    stopHeartbeat();
    subscribedRooms.clear();
    announcedRooms.clear();
    clearAllRosters();
    if (isActive()) scheduleReconnect();
  };
}

function clearConnectTimer(): void {
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer || !isActive()) return;
  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (isActive()) connect();
  }, delay);
}

function clearAllRosters(): void {
  const rooms = [...rosters.keys()];
  rosters.clear();
  for (const room of rooms) commit(room);
}

function teardown(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearConnectTimer();
  stopHeartbeat();
  backoffMs = RECONNECT_MIN_MS;
  subscribedRooms.clear();
  announcedRooms.clear();
  announcedPetKey = "";
  const sock = ws;
  ws = null;
  connecting = false;
  if (sock) {
    try {
      sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
      sock.close();
    } catch {
      /* ignore */
    }
  }
  clearAllRosters();
}

/** Declare the desired multiplayer state; the client reconciles to it. */
export function setPetMultiplayerDesired(next: PetMultiplayerDesired): void {
  desired = next;
  try {
    reconcile();
  } catch {
    /* reconcile must never throw into a React render/effect */
  }
}

/** Subscribe to roster changes for one room. Returns an unsubscribe fn. */
export function subscribePetRoster(room: string, cb: () => void): () => void {
  let set = rosterListeners.get(room);
  if (!set) {
    set = new Set();
    rosterListeners.set(room, set);
  }
  set.add(cb);
  return () => {
    const s = rosterListeners.get(room);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) rosterListeners.delete(room);
  };
}

/** Current peers in a room (excludes self). Stable identity between changes. */
export function getPetRoster(room: string | null): PetPeer[] {
  if (!room) return EMPTY_PEERS;
  return snapshots.get(room) ?? EMPTY_PEERS;
}
