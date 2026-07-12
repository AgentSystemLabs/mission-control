// Bottom-of-screen overlay showing the pets of OTHER people working on the same
// repo as the project you're viewing. Purely decorative (pointer-events: none)
// and wrapped in an error boundary so nothing here — including an unreachable
// relay surfaced as a render error — can ever take down the app shell.

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { PET_SPECIES } from "~/components/pet/PetSprite";
import { DEFAULT_PET_SPECIES } from "~/shared/pet";
import { Z_INDEX } from "~/lib/z-index";
import { usePetMultiplayer } from "~/lib/pet/use-pet-multiplayer";
import { pickRemotePetMessage } from "~/lib/pet/pet-multiplayer-messages";
import type { PetPeer } from "~/shared/pet-multiplayer-protocol";
import { usePetSnapshot } from "~/lib/pet/pet-store";
import { useDockLift } from "~/lib/pet/use-dock-lift";

const SPRITE_PX = 56;
const MAX_VISIBLE = 6;
const BUBBLE_MS = 6_000;
const SPEAK_EVERY_MS = 22_000;
/** Resting distance from the window's bottom edge when there's no dock. */
const GROUND_GAP_PX = 12;
/** Empty space under the sprite's feet — mirrors the local pet so feet perch. */
const SPRITE_BOTTOM_WHITESPACE = 0.09;

class RemotePetsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    // Swallow — multiplayer pets are cosmetic; never disrupt the app.
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function RemotePetsInner(): ReactNode {
  const peers = usePetMultiplayer();
  const visible = peers.slice(0, MAX_VISIBLE);
  const overflow = peers.length - visible.length;
  // Sit on the opposite bottom corner from the local pet.
  const localHome = usePetSnapshot().homeSide;
  // Perch on the terminal dock exactly like the local pet, so peers stand on
  // the same line instead of floating inside the open terminal panel.
  const dockLift = useDockLift();

  // peerId -> current speech line (absent = not speaking right now).
  const [bubbles, setBubbles] = useState<Record<string, string>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saltRef = useRef(0);
  const seenRef = useRef(new Set<string>());

  const speak = (peerId: string): void => {
    const salt = ++saltRef.current;
    setBubbles((prev) => ({ ...prev, [peerId]: pickRemotePetMessage(peerId, salt) }));
    const existing = timers.current.get(peerId);
    if (existing) clearTimeout(existing);
    timers.current.set(
      peerId,
      setTimeout(() => {
        timers.current.delete(peerId);
        setBubbles((prev) => {
          if (!(peerId in prev)) return prev;
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
      }, BUBBLE_MS),
    );
  };

  // Greet each newly-appeared peer; forget peers that have left.
  const presentIds = peers.map((p) => p.id).join(",");
  useEffect(() => {
    const present = new Set(peers.map((p) => p.id));
    for (const p of peers) {
      if (!seenRef.current.has(p.id)) {
        seenRef.current.add(p.id);
        speak(p.id);
      }
    }
    for (const id of [...seenRef.current]) {
      if (!present.has(id)) seenRef.current.delete(id);
    }
    // presentIds is the stable key for "which peers exist".
  }, [presentIds]);

  // Every so often, one present pet pipes up again.
  useEffect(() => {
    if (peers.length === 0) return;
    const interval = setInterval(() => {
      const pick = peers[Math.floor(Math.random() * peers.length)];
      if (pick) speak(pick.id);
    }, SPEAK_EVERY_MS);
    return () => clearInterval(interval);
  }, [presentIds]);

  // Clear all pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      className="mc-remote-pets"
      data-local-home={localHome}
      style={{
        // `position` MUST be inline: `#root > * { position: relative }` (an id
        // selector) outranks the `.mc-remote-pets` class, so a class-declared
        // `position: fixed` loses and the container drops into #root's flex
        // column — shoving the terminal dock up whenever a peer appears. Inline
        // wins the cascade, exactly as the local PetWidget does.
        position: "fixed",
        zIndex: Z_INDEX.pet,
        bottom:
          dockLift > 0 ? dockLift - SPRITE_PX * SPRITE_BOTTOM_WHITESPACE : GROUND_GAP_PX,
        transition: "bottom 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
      aria-hidden="true"
    >
      {visible.map((peer) => (
        <RemotePet key={peer.id} peer={peer} bubble={bubbles[peer.id]} />
      ))}
      {overflow > 0 ? <div className="mc-remote-pets-overflow">+{overflow}</div> : null}
    </div>
  );
}

function RemotePet({ peer, bubble }: { peer: PetPeer; bubble?: string }): ReactNode {
  const species = PET_SPECIES[peer.species] ? peer.species : DEFAULT_PET_SPECIES;
  const Sprite = PET_SPECIES[species].Sprite;
  return (
    <div className="mc-remote-pet">
      {/* Name + bubble float above the sprite (position: absolute) so their
          width isn't clamped to the sprite column — otherwise a chatty line
          wraps one word per line into a tall tower — and so they never push
          the surrounding layout. */}
      <div className="mc-remote-pet-labels">
        {bubble ? <div className="mc-remote-pet-bubble">{bubble}</div> : null}
        <div className="mc-remote-pet-name" title={peer.name}>
          {peer.name}
        </div>
      </div>
      <div className="mc-remote-pet-sprite">
        <Sprite
          mood="working"
          intensity={1}
          night={false}
          level={peer.level}
          prestige={peer.prestige}
          size={SPRITE_PX}
        />
      </div>
    </div>
  );
}

export function RemotePets(): ReactNode {
  return (
    <RemotePetsBoundary>
      <RemotePetsInner />
    </RemotePetsBoundary>
  );
}
