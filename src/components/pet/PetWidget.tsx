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
  PET_WANDER_RANGE_PX,
  petInteract,
  petStroke,
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
  const holdTimer = useRef<number | null>(null);
  const strokeTimer = useRef<number | null>(null);
  // Set when a hold turned into stroking, so the pointer-up click stays quiet.
  const suppressClick = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [stroking, setStroking] = useState(false);

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

  if (!pet.enabled) return null;

  const { Sprite } = PET_SPECIES[pet.species] ?? PET_SPECIES[DEFAULT_PET_SPECIES];

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    // While alert, the click is a jump-to-session shortcut — keep it instant.
    if (event.button !== 0 || pet.mood === "alert") return;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      suppressClick.current = true;
      setStroking(true);
      petStroke();
      strokeTimer.current = window.setInterval(() => petStroke(), STROKE_TICK_MS);
    }, HOLD_TO_STROKE_MS);
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
          transition: pet.wander.durationMs
            ? `transform ${Math.round(pet.wander.durationMs)}ms linear`
            : "transform 400ms ease",
        }}
      >
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
        <div className="mc-pet-stage" ref={stageRef} style={{ position: "relative" }}>
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
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => {
                  setHovered(false);
                  stopStroking();
                }}
                onPointerDown={handlePointerDown}
                onPointerUp={stopStroking}
                onPointerCancel={stopStroking}
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
