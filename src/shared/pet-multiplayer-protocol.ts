// Client-side mirror of the academy pets relay protocol
// (../academy/pets-ws/protocol.ts). Keep the two in sync. Only the pieces
// the renderer needs live here — message shapes + timing. Validation/clamping
// is the server's job.

import type { PetSpeciesId } from "~/shared/pet";

/** Re-announce presence at this cadence while a session is running. */
export const PET_WS_HEARTBEAT_MS = 15_000;
/** Locally drop a peer we haven't heard from in this long (belt-and-suspenders
 *  on top of the server's own TTL sweep). */
export const PET_WS_PEER_TTL_MS = 45_000;

/** Accent palette ids — mirrors `AccentColorId` in lib/accent-colors and
 *  `PET_ACCENT_IDS` in academy/pets-ws/protocol.ts. Keep all three in sync. */
export const PET_ACCENT_IDS = [
  "deep-orange",
  "terracotta",
  "blue",
  "green",
  "teal",
  "cyan",
  "purple",
  "magenta",
  "pink",
  "red",
  "amber",
  "lime",
  "indigo",
  "slate",
] as const;
export type PetAccentId = (typeof PET_ACCENT_IDS)[number];
export const DEFAULT_PET_ACCENT: PetAccentId = "deep-orange";

export function isPetAccentId(v: unknown): v is PetAccentId {
  return typeof v === "string" && (PET_ACCENT_IDS as readonly string[]).includes(v);
}

/** The only per-user data on the wire: an ephemeral id, a species, a name,
 *  the two cosmetic progression fields needed to draw the pet the way its owner
 *  sees it — `level` (earned gear: sparkle ≥3, scarf ≥5, belt ≥8, crown ≥10)
 *  and `prestige` (molt count; ≥1 pins the star badge) — plus `accent` so peers
 *  render the sprite in the owner's selected theme color. */
export type PetPeer = {
  id: string;
  species: PetSpeciesId;
  name: string;
  level: number;
  prestige: number;
  /** Owner's accent color id; absent/unknown from older clients → deep-orange. */
  accent: PetAccentId;
};

export type PetClientMessage =
  | { type: "sub"; room: string }
  | { type: "unsub"; room: string }
  | { type: "presence"; room: string; peer: PetPeer }
  | { type: "bye"; room: string; peerId: string };

export type PetServerMessage =
  | { type: "roster"; room: string; peers: PetPeer[] }
  | { type: "join"; room: string; peer: PetPeer }
  | { type: "leave"; room: string; peerId: string };
