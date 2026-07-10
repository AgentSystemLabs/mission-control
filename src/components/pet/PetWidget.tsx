import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { petInteract, usePetSnapshot, type PetMood } from "~/lib/pet/pet-store";
import { requestSessionOpenById } from "~/lib/session-notification-store";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { Z_INDEX } from "~/lib/z-index";
import type { Task } from "~/db/schema";
import { PET_SPECIES } from "./PetSprite";

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

  if (!pet.enabled) return null;

  const { Sprite } = PET_SPECIES.blob;

  const handleClick = () => {
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
    <div
      className="mc-pet-widget"
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: Z_INDEX.pet,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
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
      <div className="mc-pet-stage" style={{ position: "relative" }}>
        {/* Hearts burst on petting; keyed so each burst restarts the animation. */}
        {pet.heartsBurstId > 0 ? (
          <div key={pet.heartsBurstId} className="mc-pet-hearts" aria-hidden>
            <span className="mc-pet-heart">♥</span>
            <span className="mc-pet-heart mc-pet-heart-2">♥</span>
            <span className="mc-pet-heart mc-pet-heart-3">♥</span>
          </div>
        ) : null}
        <button
          type="button"
          className="mc-pet-button"
          onClick={handleClick}
          aria-label={`${pet.name || "Pet"} — ${MOOD_DESCRIPTION[pet.mood]}`}
          title={`${pet.name || "Pet"} · Lv ${pet.level} · ${MOOD_DESCRIPTION[pet.mood]}`}
          data-mood={pet.mood}
        >
          <Sprite mood={pet.mood} intensity={pet.intensity} night={pet.night} level={pet.level} />
        </button>
      </div>
    </div>
  );
}
