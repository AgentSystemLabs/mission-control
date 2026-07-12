// Bottom-of-screen overlay showing the pets of OTHER people working on the same
// repo as the project you're viewing. Each peer can be picked up and dropped;
// after landing it idly wanders a little left/right from that drop point.
// Wrapped in an error boundary so nothing here — including an unreachable
// relay surfaced as a render error — can ever take down the app shell.

import {
  Component,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PET_SPECIES } from "~/components/pet/PetSprite";
import { DEFAULT_PET_SPECIES } from "~/shared/pet";
import { Z_INDEX } from "~/lib/z-index";
import { accentCssVars } from "~/lib/accent-colors";
import { usePetMultiplayer } from "~/lib/pet/use-pet-multiplayer";
import { pickRemotePetMessage } from "~/lib/pet/pet-multiplayer-messages";
import { getPeerAnchorX, setPeerAnchorX } from "~/lib/pet/peer-anchors";
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
/** How far a peer may stroll from its last drop point. */
const PEER_WANDER_RADIUS_PX = 52;
const PEER_WALK_SPEED_PX_PER_S = 32;
const PEER_WANDER_TICK_MS = 5_500;
const PEER_SPACING_PX = 78;
const EDGE_PAD_PX = 16;
/** Moving the pointer this far while held turns the hold into a drag. */
const DRAG_START_PX = 12;
const DROP_MAX_MS = 350;
const DROP_MIN_MS = 140;
const MIN_FALL_PX = 24;

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

function clampPeerX(x: number): number {
  const max = Math.max(EDGE_PAD_PX, window.innerWidth - SPRITE_PX - EDGE_PAD_PX);
  return Math.min(max, Math.max(EDGE_PAD_PX, Math.round(x)));
}

/** Default left-edge of the i-th peer, parked opposite the local pet. */
function defaultPeerX(index: number, localHome: "left" | "right"): number {
  if (localHome === "left") {
    return clampPeerX(window.innerWidth - EDGE_PAD_PX - SPRITE_PX - index * PEER_SPACING_PX);
  }
  return clampPeerX(EDGE_PAD_PX + index * PEER_SPACING_PX);
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

  // Greet each newly-appeared peer. Drop positions live in peer-anchors (module
  // + localStorage) so leaving a project — or a brief roster gap — does not
  // wipe them; only clear the in-session "already greeted" set when they leave
  // so a real rejoin still gets a hello.
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
    // Seed a default park spot the first time we see a peer so list reshuffles
    // don't move them (mirrors the old anchorsRef write-on-first-sight).
    visible.forEach((peer, index) => {
      if (getPeerAnchorX(peer.id) == null) {
        setPeerAnchorX(peer.id, defaultPeerX(index, localHome));
      }
    });
    // presentIds is the stable key for "which peers exist".
  }, [presentIds, localHome]);

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
    >
      {visible.map((peer, index) => {
        const initialX = getPeerAnchorX(peer.id) ?? defaultPeerX(index, localHome);
        return (
          <RemotePet
            key={peer.id}
            peer={peer}
            bubble={bubbles[peer.id]}
            initialX={initialX}
            onAnchorChange={(x) => {
              setPeerAnchorX(peer.id, x);
            }}
          />
        );
      })}
      {overflow > 0 ? (
        <div
          className="mc-remote-pets-overflow"
          style={
            localHome === "left"
              ? { right: EDGE_PAD_PX + visible.length * PEER_SPACING_PX }
              : { left: EDGE_PAD_PX + visible.length * PEER_SPACING_PX }
          }
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}

type RemotePetProps = {
  peer: PetPeer;
  bubble?: string;
  initialX: number;
  onAnchorChange: (x: number) => void;
};

function RemotePet({ peer, bubble, initialX, onAnchorChange }: RemotePetProps): ReactNode {
  const species = PET_SPECIES[peer.species] ? peer.species : DEFAULT_PET_SPECIES;
  const Sprite = PET_SPECIES[species].Sprite;
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Anchor = last drop; x = current stroll position (CSS-transitioned).
  const [anchorX, setAnchorX] = useState(initialX);
  const [x, setX] = useState(initialX);
  const [durationMs, setDurationMs] = useState(0);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [instantJump, setInstantJump] = useState(false);
  const [dragPhase, setDragPhase] = useState<"held" | "dropping" | null>(null);
  const heldRef = useRef(false);
  const xRef = useRef(initialX);
  const anchorRef = useRef(initialX);
  xRef.current = x;
  anchorRef.current = anchorX;
  const arriveTimer = useRef<number | null>(null);
  const dropTimer = useRef<number | null>(null);
  const dropFinish = useRef<(() => void) | null>(null);
  const dragOrigin = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    active: boolean;
    minDx: number;
    maxDx: number;
    minDy: number;
    maxDy: number;
    dx: number;
    dy: number;
    raf: number;
  } | null>(null);

  const walkTo = (target: number) => {
    if (heldRef.current) return;
    const current = xRef.current;
    const anchor = anchorRef.current;
    const clamped = clampPeerX(
      Math.min(anchor + PEER_WANDER_RADIUS_PX, Math.max(anchor - PEER_WANDER_RADIUS_PX, target)),
    );
    const dist = Math.abs(clamped - current);
    if (dist < 8) return;
    const ms = (dist / PEER_WALK_SPEED_PX_PER_S) * 1000;
    setFacing(clamped >= current ? 1 : -1);
    setX(clamped);
    setDurationMs(ms);
    if (arriveTimer.current !== null) window.clearTimeout(arriveTimer.current);
    arriveTimer.current = window.setTimeout(() => {
      arriveTimer.current = null;
      setDurationMs(0);
    }, ms + 30);
  };

  // Idle stroll around the drop point. Re-armed when the anchor moves so a
  // fresh drop starts wandering from the new spot (not the old radius).
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const tick = () => {
      if (heldRef.current || document.hidden) return;
      if (Math.random() < 0.55) {
        const target = anchorRef.current + (Math.random() * 2 - 1) * PEER_WANDER_RADIUS_PX;
        walkTo(target);
      }
    };
    const interval = window.setInterval(tick, PEER_WANDER_TICK_MS);
    // Stagger the first stroll so peers don't lock-step.
    const first = window.setTimeout(tick, 800 + Math.random() * 2_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(first);
    };
  }, [anchorX]);

  useEffect(
    () => () => {
      if (arriveTimer.current !== null) window.clearTimeout(arriveTimer.current);
      if (dropTimer.current !== null) window.clearTimeout(dropTimer.current);
      const origin = dragOrigin.current;
      if (origin?.raf) cancelAnimationFrame(origin.raf);
    },
    [],
  );

  // Keep on-screen if the window shrinks under a parked peer.
  useEffect(() => {
    const onResize = () => {
      setAnchorX((prev) => {
        const next = clampPeerX(prev);
        if (next !== prev) onAnchorChange(next);
        return next;
      });
      setX((prev) => clampPeerX(prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onAnchorChange]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (dropTimer.current !== null) {
      window.clearTimeout(dropTimer.current);
      dropTimer.current = null;
      dropFinish.current?.();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    // Read the live CSS-interpolated X so a mid-walk grab doesn't jump.
    let baseX = x;
    const stage = stageRef.current;
    if (stage) {
      baseX = clampPeerX(stage.getBoundingClientRect().left);
    }
    dragOrigin.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX,
      active: false,
      minDx: 0,
      maxDx: 0,
      minDy: 0,
      maxDy: 0,
      dx: 0,
      dy: 0,
      raf: 0,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    if (event.buttons === 0) {
      dragOrigin.current = null;
      return;
    }
    const rawDx = event.clientX - origin.startX;
    const rawDy = event.clientY - origin.startY;
    if (!origin.active) {
      if (Math.hypot(rawDx, rawDy) < DRAG_START_PX) return;
      origin.active = true;
      heldRef.current = true;
      if (arriveTimer.current !== null) {
        window.clearTimeout(arriveTimer.current);
        arriveTimer.current = null;
      }
      // Pin at the visual X; cancel any in-flight stroll transition.
      setX(origin.baseX);
      setDurationMs(0);
      setInstantJump(true);
      window.setTimeout(() => setInstantJump(false), 50);
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) {
        origin.minDx = -rect.left + 4;
        origin.maxDx = window.innerWidth - rect.right - 4;
        origin.minDy = -rect.top + 4;
        origin.maxDy = Math.max(0, window.innerHeight - rect.bottom - 2);
      }
      origin.startX = event.clientX;
      origin.startY = event.clientY;
      setDragPhase("held");
      return;
    }
    origin.dx = Math.min(origin.maxDx, Math.max(origin.minDx, rawDx));
    origin.dy = Math.min(origin.maxDy, Math.max(origin.minDy, rawDy));
    if (!origin.raf) {
      origin.raf = requestAnimationFrame(() => {
        origin.raf = 0;
        const stage = stageRef.current;
        if (stage) stage.style.transform = `translate(${origin.dx}px, ${origin.dy}px)`;
      });
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return false;
    dragOrigin.current = null;
    if (!origin.active) return false;
    if (origin.raf) cancelAnimationFrame(origin.raf);
    const landing = clampPeerX(origin.baseX + origin.dx);
    const stage = stageRef.current;
    const finish = () => {
      dropFinish.current = null;
      if (stage) {
        stage.style.transition = "";
        stage.style.transform = "";
      }
      setInstantJump(true);
      setDragPhase(null);
      heldRef.current = false;
      setAnchorX(landing);
      setX(landing);
      setDurationMs(0);
      onAnchorChange(landing);
      window.setTimeout(() => setInstantJump(false), 50);
    };
    dropFinish.current = finish;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const fallHeight = Math.max(0, -origin.dy);
    if (reducedMotion || !stage || fallHeight < MIN_FALL_PX) {
      finish();
    } else {
      setDragPhase("dropping");
      stage.style.transition = "none";
      stage.style.transform = `translate(${origin.dx}px, ${origin.dy}px)`;
      stage.getBoundingClientRect();
      const fallMs = Math.max(
        DROP_MIN_MS,
        Math.min(DROP_MAX_MS, Math.round(22 * Math.sqrt(fallHeight))),
      );
      stage.style.transition = `transform ${fallMs}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
      stage.style.transform = `translate(${origin.dx}px, 0px)`;
      if (dropTimer.current !== null) window.clearTimeout(dropTimer.current);
      dropTimer.current = window.setTimeout(() => {
        dropTimer.current = null;
        finish();
      }, fallMs + 30);
    }
    return true;
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    endDrag(event);
  };

  return (
    <div
      className="mc-remote-pet"
      data-dragging={dragPhase === "held" || undefined}
      data-dropping={dragPhase === "dropping" || undefined}
      style={{
        left: x,
        zIndex: dragPhase ? 2 : undefined,
        // Scope the owner's accent onto this pet so strokes/fills match their
        // theme without flipping the whole app's accent.
        ...(accentCssVars(peer.accent) as CSSProperties),
        transition: instantJump
          ? "none"
          : durationMs
            ? `left ${Math.round(durationMs)}ms linear`
            : undefined,
      }}
    >
      <div className="mc-remote-pet-labels">
        {bubble ? <div className="mc-remote-pet-bubble">{bubble}</div> : null}
        <div className="mc-remote-pet-name" title={peer.name}>
          {peer.name}
        </div>
      </div>
      <div
        className="mc-remote-pet-stage"
        ref={stageRef}
        data-dragging={dragPhase === "held" || undefined}
        data-dropping={dragPhase === "dropping" || undefined}
        style={{ willChange: dragPhase ? "transform" : undefined }}
      >
        <div
          className="mc-remote-pet-sprite"
          style={{ transform: `scaleX(${facing})` }}
        >
          <button
            type="button"
            className="mc-remote-pet-button"
            aria-label={`${peer.name}'s pet — drag to move`}
            title={`${peer.name} · Lv ${peer.level}${peer.prestige > 0 ? ` ★${peer.prestige}` : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <Sprite
              mood="working"
              intensity={1}
              night={false}
              level={peer.level}
              prestige={peer.prestige}
              size={SPRITE_PX}
            />
          </button>
        </div>
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
