import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getPetPersistentState,
  PET_WANDER_RANGE_PX,
  petGrabbed,
  petInteract,
  petSetStatsOpen,
  petStroke,
  petTossed,
  usePetSnapshot,
  type PetMood,
} from "~/lib/pet/pet-store";
import { requestSessionOpenById } from "~/lib/session-notification-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { DEFAULT_PET_SPECIES, type PetSizeId } from "~/shared/pet";
import { Z_INDEX } from "~/lib/z-index";
import type { Task } from "~/db/schema";
import { PET_SPECIES } from "./PetSprite";
import { PetStatsCard } from "./PetStatsCard";

/** Rendered sprite size per setting; "m" is the pre-setting default (84px). */
const SIZE_PX: Record<PetSizeId, number> = { s: 64, m: 84, l: 108 };

/** What the pet "feels" above its head when your cursor hovers it. */
const MOOD_EMOTE: Record<PetMood, string> = {
  sleeping: "?",
  idle: "♥",
  watching: "♥",
  working: "…",
  alert: "!",
  celebrating: "♪",
  shipping: "…",
  startled: "!",
};

/** Resting distance from the window's bottom edge when there's no dock. */
const GROUND_GAP_PX = 18;
/**
 * The sprite art bottoms out at y≈91 of its 100-unit viewBox (feet paths at
 * y=90 plus half their stroke), so ~9% of the rendered sprite is empty space
 * under the feet. Subtract it when perching so the feet — not the invisible
 * box edge — touch the dock.
 */
const SPRITE_BOTTOM_WHITESPACE = 0.09;

/** Holding the pointer down this long turns a click into stroking. */
const HOLD_TO_STROKE_MS = 350;
const STROKE_TICK_MS = 600;
/** Moving the pointer this far while held turns the hold into a drag. */
const DRAG_START_PX = 12;
/** Longest the release-drop bounce may run (a full-window fall). */
const DROP_MAX_MS = 350;
/** Shortest drop that still reads as a fall rather than a blink. */
const DROP_MIN_MS = 140;
/** Released lower than this above the ground, there's nothing to fall. */
const MIN_FALL_PX = 24;
/** Pupils track the cursor inside this radius around the pet. */
const LOOK_RADIUS_PX = 220;
/** Max pupil offset, in sprite user units (the eye radius is ~6). */
const LOOK_MAX_X = 2.2;
const LOOK_MAX_Y = 1.6;

const MOOD_DESCRIPTION: Record<PetMood, string> = {
  sleeping: "asleep",
  idle: "idle",
  watching: "watching you type",
  working: "working alongside your agents",
  alert: "an agent needs your input — click to jump there",
  celebrating: "celebrating a finished session",
  shipping: "shipping your changes",
  startled: "startled",
};

/**
 * Mission Pet — floating corner companion. Renders nothing when disabled.
 * The container is click-through; only the pet button takes pointer events.
 */
export function PetWidget() {
  const pet = usePetSnapshot();
  const router = useRouter();
  const queryClient = useQueryClient();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const walkerRef = useRef<HTMLDivElement | null>(null);
  const holdTimer = useRef<number | null>(null);
  const strokeTimer = useRef<number | null>(null);
  // Set when a hold turned into stroking, so the pointer-up click stays quiet.
  const suppressClick = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [stroking, setStroking] = useState(false);
  // Pick-up-and-toss. All per-move bookkeeping lives in a ref and the drag
  // offset is applied imperatively (rAF-throttled style.transform) — a React
  // re-render per pointermove makes the whole sprite janky. Only the phase
  // flips (held / dropping / done) go through state.
  const dragOrigin = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    wanderX: number;
    active: boolean;
    /** Viewport clamp for the offset, so the pet can't leave the window. */
    minDx: number;
    maxDx: number;
    minDy: number;
    maxDy: number;
    /** Last clamped offset — also the release position. */
    dx: number;
    dy: number;
    raf: number;
  } | null>(null);
  const dropTimer = useRef<number | null>(null);
  const [dragPhase, setDragPhase] = useState<"held" | "dropping" | null>(null);
  // One render with no walker transition, so the post-toss wander.x handoff
  // doesn't animate (the stage offset and the walker offset cancel exactly).
  const [instantJump, setInstantJump] = useState(false);

  // The pet perches on the bottom terminal dock instead of covering it: track
  // how far the dock's top edge rises above the viewport bottom and lift the
  // whole widget by that much. A ResizeObserver follows the dock's slide
  // open/close and drag-resizes; the store scope re-arms the observer when the
  // dock mounts/unmounts on project switches (it renders only on project/home
  // scopes). The widget's own `bottom` transition turns those retargets into
  // the fly-up / fall motion.
  const { project: dockProject, homeActive } = useUserTerminals();
  const dockActive = !!dockProject || homeActive;
  const [dockLift, setDockLift] = useState(0);
  useEffect(() => {
    if (!pet.enabled) return;
    const measure = () => {
      const dock = document.querySelector("[data-user-terminal-panel]");
      setDockLift(
        dock
          ? Math.max(0, window.innerHeight - dock.getBoundingClientRect().top)
          : 0,
      );
    };
    measure();
    let observer: ResizeObserver | null = null;
    const dock = document.querySelector("[data-user-terminal-panel]");
    if (dock && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(dock);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [pet.enabled, dockActive]);

  // Pupils follow the cursor when it comes near — the pet sees you coming.
  // Imperative CSS vars on the stage (no re-render); the sprite reads them
  // via `translate` on .mc-pet-pupil-set.
  useEffect(() => {
    if (!pet.enabled) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (event: MouseEvent) => {
      if (raf) return;
      const { clientX, clientY } = event;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        const dx = clientX - (rect.left + rect.width / 2);
        const dy = clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        const near = dist > 0 && dist <= LOOK_RADIUS_PX;
        stage.style.setProperty(
          "--pet-look-x",
          near ? `${((dx / dist) * LOOK_MAX_X).toFixed(2)}px` : "0px",
        );
        stage.style.setProperty(
          "--pet-look-y",
          near ? `${((dy / dist) * LOOK_MAX_Y).toFixed(2)}px` : "0px",
        );
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pet.enabled]);

  const stopStroking = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (strokeTimer.current !== null) {
      window.clearInterval(strokeTimer.current);
      strokeTimer.current = null;
    }
    setStroking(false);
  }, []);

  // Stop any in-flight hold/stroke when the pet is disabled…
  useEffect(() => {
    if (!pet.enabled) stopStroking();
  }, [pet.enabled, stopStroking]);
  // …and never leave the interval ticking past unmount.
  useEffect(() => stopStroking, [stopStroking]);
  // Never leave a drop mid-flight or a drag frame queued past unmount.
  useEffect(
    () => () => {
      if (dropTimer.current !== null) window.clearTimeout(dropTimer.current);
      const origin = dragOrigin.current;
      if (origin?.raf) cancelAnimationFrame(origin.raf);
    },
    [],
  );

  if (!pet.enabled) return null;

  const { Sprite } = PET_SPECIES[pet.species] ?? PET_SPECIES[DEFAULT_PET_SPECIES];
  // The card reads the persistent identity directly — a render-time read is
  // fine because opening/closing (and every XP change) re-renders anyway.
  const statsState = pet.statsOpen ? getPetPersistentState() : null;
  const closeStats = () => petSetStatsOpen(false);
  const hour = new Date().getHours();
  const showCoffee =
    (pet.mood === "idle" || pet.mood === "watching") && hour >= 6 && hour < 10 && !pet.bubble;

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    // While alert, the click is a jump-to-session shortcut — keep it instant.
    if (event.button !== 0 || pet.mood === "alert") return;
    // Capture at press, not at drag activation: a walking pet can slide out
    // from under the press, and without capture the button never receives the
    // pointerup — the drag origin goes stale and later hover movement fakes a
    // buttonless drag. Capture also means a moving pet stays catchable.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      wanderX: pet.wander.x,
      active: false,
      minDx: 0,
      maxDx: 0,
      minDy: 0,
      maxDy: 0,
      dx: 0,
      dy: 0,
      raf: 0,
    };
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      suppressClick.current = true;
      setStroking(true);
      petStroke();
      strokeTimer.current = window.setInterval(() => petStroke(), STROKE_TICK_MS);
    }, HOLD_TO_STROKE_MS);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    // A drag needs a held button. If the release was missed somehow (capture
    // lost, window switch), drop the stale origin instead of letting plain
    // hover movement fake a drag.
    if (event.buttons === 0) {
      dragOrigin.current = null;
      return;
    }
    const rawDx = event.clientX - origin.startX;
    const rawDy = event.clientY - origin.startY;
    if (!origin.active) {
      if (Math.hypot(rawDx, rawDy) < DRAG_START_PX) return;
      // The hold became a pick-up: no stroking, no click.
      origin.active = true;
      suppressClick.current = true;
      stopStroking();
      // Grabbed mid-walk, the store already holds the walk's *target* while
      // the walker is visually mid-transition. Read the real interpolated
      // offset and pin the pet there — otherwise the walk keeps sliding the
      // walker underneath the drag and carries the pet off screen.
      const walker = walkerRef.current;
      if (walker) {
        const transform = getComputedStyle(walker).transform;
        if (transform && transform !== "none") {
          origin.wanderX = Math.max(0, Math.round(-new DOMMatrixReadOnly(transform).m41));
        }
      }
      petGrabbed(origin.wanderX);
      // Clamp the offset to the stage's resting rect vs the viewport — the
      // pet stays fully on screen no matter where the pointer goes.
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) {
        origin.minDx = -rect.left + 4;
        origin.maxDx = window.innerWidth - rect.right - 4;
        origin.minDy = -rect.top + 4;
        origin.maxDy = Math.max(0, window.innerHeight - rect.bottom - 2);
      }
      // Rebase to the pointer's position *now*: with capture-at-press the
      // pointer may have chased a walking pet a long way since pointerdown,
      // and that chase distance must not be replayed as drag offset.
      origin.startX = event.clientX;
      origin.startY = event.clientY;
      setDragPhase("held");
      return;
    }
    origin.dx = Math.min(origin.maxDx, Math.max(origin.minDx, rawDx));
    origin.dy = Math.min(origin.maxDy, Math.max(origin.minDy, rawDy));
    // Imperative + rAF-coalesced: no React work on the pointermove firehose.
    if (!origin.raf) {
      origin.raf = requestAnimationFrame(() => {
        origin.raf = 0;
        const stage = stageRef.current;
        if (stage) stage.style.transform = `translate(${origin.dx}px, ${origin.dy}px)`;
      });
    }
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return false;
    dragOrigin.current = null;
    if (!origin.active) return false;
    if (origin.raf) cancelAnimationFrame(origin.raf);
    // wander.x counts px left of home, so dragging right (dx > 0) reduces it.
    // Use the clamped offset — it's where the pet visually is.
    const landing = Math.max(
      0,
      Math.min(window.innerWidth - 140, Math.round(origin.wanderX - origin.dx)),
    );
    const stage = stageRef.current;
    const finish = () => {
      if (stage) {
        stage.style.transition = "";
        stage.style.transform = "";
      }
      // Hand the position to the store with the walker transition suppressed:
      // clearing the stage offset and adopting wander.x = landing cancel out.
      setInstantJump(true);
      setDragPhase(null);
      petTossed(landing);
      window.setTimeout(() => setInstantJump(false), 50);
    };
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // How high above the ground line it was released (dy ≤ 0 means lifted).
    // A low release lands in place — no theatrical fall from a sideways drag.
    const fallHeight = Math.max(0, -origin.dy);
    if (reducedMotion || !stage || fallHeight < MIN_FALL_PX) {
      finish();
    } else {
      // Let go: fall straight down from where it was dropped, over a duration
      // that scales with the actual height, then hand off.
      setDragPhase("dropping");
      // The rAF write may not have flushed the final offset yet — pin the
      // exact release position first so the fall starts from where you see it.
      stage.style.transition = "none";
      stage.style.transform = `translate(${origin.dx}px, ${origin.dy}px)`;
      stage.getBoundingClientRect(); // flush, so the transition starts here
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

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!endDrag(event)) stopStroking();
  };

  const handleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const { navigateTo } = petInteract();
    if (!navigateTo) return;
    // Best effort: find the task in any cached tasks query to recover its
    // worktree/scope; fall back to the local scope (mirrors the OS-notification
    // click-through in use-session-finish-notifications).
    let task: Task | undefined;
    for (const [, data] of queryClient.getQueriesData<{ tasks?: Task[] } | Task[]>({
      queryKey: ["projects", navigateTo.projectId, "tasks"],
    })) {
      const tasks = Array.isArray(data) ? data : data?.tasks;
      task = tasks?.find((t) => t.id === navigateTo.taskId);
      if (task) break;
    }
    requestSessionOpenById({
      projectId: navigateTo.projectId,
      worktreeId: task?.worktreeId ?? null,
      scopeId: task?.scopeId ?? LOCAL_SCOPE_ID,
      taskId: navigateTo.taskId,
    });
    void router.navigate({ to: "/projects/$id", params: { id: navigateTo.projectId } });
  };

  return (
    // A click-through strip along the bottom edge; the pet wanders inside it
    // (translateX left of its home corner) and only the pet itself is clickable.
    <div
      className="mc-pet-widget"
      style={{
        position: "fixed",
        right: 18,
        bottom:
          dockLift > 0
            ? dockLift - SIZE_PX[pet.size] * SPRITE_BOTTOM_WHITESPACE
            : GROUND_GAP_PX,
        width: PET_WANDER_RANGE_PX + 100,
        zIndex: Z_INDEX.pet,
        pointerEvents: "none",
        // Overshooting ease so the pet visibly flies up onto the dock as it
        // opens and drops back down when it closes or goes away.
        transition: "bottom 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      <div
        className="mc-pet-walker"
        ref={walkerRef}
        data-walking={pet.wander.walking || undefined}
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          transform: `translateX(${-pet.wander.x}px)`,
          transition: instantJump
            ? "none"
            : pet.wander.durationMs
              ? `transform ${Math.round(pet.wander.durationMs)}ms linear`
              : "transform 400ms ease",
        }}
      >
        {statsState ? <PetStatsCard state={statsState} onClose={closeStats} /> : null}
        {pet.bubble ? (
          <div
            key={pet.bubble.id}
            className="mc-pet-bubble"
            data-priority={pet.bubble.priority}
            role="status"
            aria-live="polite"
          >
            {pet.bubble.text}
          </div>
        ) : null}
        <div
          className="mc-pet-stage"
          ref={stageRef}
          data-dragging={dragPhase === "held" || undefined}
          data-dropping={dragPhase === "dropping" || undefined}
          // transform/transition are set imperatively during a drag (see
          // handlePointerMove) — keep them out of React's style diffing.
          style={{
            position: "relative",
            willChange: dragPhase ? "transform" : undefined,
          }}
        >
          {/* Morning coffee while there's nothing urgent to watch. */}
          {showCoffee && !dragPhase ? (
            <div className="mc-pet-prop-coffee" aria-hidden>
              ☕
            </div>
          ) : null}
          {/* Emote the pet feels above its head while your cursor rests on it. */}
          {hovered && !stroking && !pet.bubble ? (
            <div className="mc-pet-emote" aria-hidden>
              {MOOD_EMOTE[pet.mood]}
            </div>
          ) : null}
          {/* Hearts burst on petting; keyed so each burst restarts the animation. */}
          {pet.heartsBurstId > 0 ? (
            <div key={pet.heartsBurstId} className="mc-pet-hearts" aria-hidden>
              <span className="mc-pet-heart">♥</span>
              <span className="mc-pet-heart mc-pet-heart-2">♥</span>
              <span className="mc-pet-heart mc-pet-heart-3">♥</span>
            </div>
          ) : null}
          {/* Flourish wrapper is keyed so each one-shot antic restarts its animation. */}
          <div
            key={pet.flourish?.id ?? 0}
            className="mc-pet-flourish"
            data-kind={pet.flourish?.kind}
          >
            <div
              style={
                {
                  transform: `scaleX(${pet.wander.facing})`,
                  // Lets the pupil-tracking CSS un-mirror its x offset.
                  "--pet-facing": pet.wander.facing,
                } as CSSProperties
              }
            >
              <button
                type="button"
                className="mc-pet-button"
                onClick={handleClick}
                onContextMenu={(event) => {
                  event.preventDefault();
                  petSetStatsOpen(!pet.statsOpen);
                }}
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => {
                  setHovered(false);
                  stopStroking();
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                aria-label={`${pet.name || "Pet"} — ${MOOD_DESCRIPTION[pet.mood]}`}
                title={`${pet.name || "Pet"} · Lv ${pet.level} · ${MOOD_DESCRIPTION[pet.mood]}`}
                data-mood={pet.mood}
                data-stroking={stroking || undefined}
              >
                <Sprite
                  mood={pet.mood}
                  intensity={pet.intensity}
                  night={pet.night}
                  level={pet.level}
                  move={pet.move}
                  size={SIZE_PX[pet.size]}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
