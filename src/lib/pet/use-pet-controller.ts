import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type Mutation } from "@tanstack/react-query";
import { api } from "~/lib/api";
import { queryKeys, useProjects, useSettings } from "~/queries";
import type { AppSettings } from "~/lib/api";
import { playNotificationDing } from "~/lib/notification-sound";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";
import {
  getPetPersistentState,
  getPetSnapshot,
  onPetLevelUp,
  petAmbientSay,
  petHydrate,
  petIngestServerEvent,
  petSetAggregates,
  petSetEnabled,
  petSetShipping,
  petSetWindowHidden,
  petShipResult,
  petSoundsOn,
  petUserActivity,
  subscribePetPersistence,
} from "./pet-store";

const PERSIST_DEBOUNCE_MS = 3_000;
const GREETING_DELAY_MS = 2_000;
const AMBIENT_TICK_MS = 60_000;
const POINTER_THROTTLE_MS = 1_000;

// Ship detection rides on the stable mutationKey suffixes defined in
// src/queries/git.ts (useGitCommit / useGitPush / useGitCreatePullRequest).
// Renaming those keys silently kills the pet's shipping reactions.
type ShipKind = "commit" | "push" | "create-pr";

function shipKindOf(mutation: Mutation<unknown, unknown, unknown, unknown>): ShipKind | null {
  const key = mutation.options.mutationKey;
  const last = Array.isArray(key) ? key[key.length - 1] : null;
  return last === "commit" || last === "push" || last === "create-pr" ? last : null;
}

/**
 * Headless Mission Pet driver, mounted once in the Shell (including focus
 * mode, where the widget itself is hidden but XP keeps accruing). Feeds every
 * real activity signal into the pet store and persists identity changes.
 */
export function usePetController(): void {
  const settings = useSettings().data;
  const projects = useProjects().data;
  const queryClient = useQueryClient();

  const petEnabled = settings?.petEnabled ?? false;

  // 1. Settings → store flags + one-shot hydration of the persistent identity.
  useEffect(() => {
    if (!settings) return;
    petSetEnabled(settings.petEnabled, settings.petMessagesEnabled, settings.petSoundsEnabled);
    if (settings.petEnabled) petHydrate(settings.petState);
  }, [settings]);

  // 2. SSE events. Stable handler — useServerEvents re-subscribes on identity change.
  const onServerEvent = useCallback((event: ServerEvent) => {
    petIngestServerEvent(event);
  }, []);
  useServerEvents(onServerEvent);

  // 3. Aggregate task counts across all projects.
  useEffect(() => {
    if (!petEnabled || !projects) return;
    let running = 0;
    let needsInput = 0;
    let interrupted = 0;
    for (const project of projects) {
      running += project.taskCounts.running;
      needsInput += project.taskCounts["needs-input"];
      interrupted += project.taskCounts.interrupted;
    }
    petSetAggregates({ running, needsInput, interrupted });
  }, [petEnabled, projects]);

  // 4. Ship operations via the MutationCache (commit / push / create-pr).
  const pendingShips = useRef(new Map<number, ShipKind>());
  useEffect(() => {
    if (!petEnabled) return;
    const cache = queryClient.getMutationCache();
    const unsubscribe = cache.subscribe((event) => {
      const mutation = event.mutation;
      if (!mutation) return;
      const kind = shipKindOf(mutation);
      if (!kind) return;
      const status = mutation.state.status;
      const pending = pendingShips.current;
      if (status === "pending" && !pending.has(mutation.mutationId)) {
        pending.set(mutation.mutationId, kind);
        if (kind !== "create-pr") {
          petSetShipping(true, kind === "push" ? "pushing" : "committing");
        }
      } else if (status === "success" || status === "error") {
        if (!pending.delete(mutation.mutationId)) return;
        const stillShipping = [...pending.values()].some((k) => k !== "create-pr");
        if (!stillShipping) petSetShipping(false, null);
        if (status === "error") petShipResult("failure");
        else if (kind === "push") petShipResult("push-success");
        else if (kind === "create-pr") petShipResult("pr-created");
      }
    });
    return () => {
      unsubscribe();
      pendingShips.current.clear();
      petSetShipping(false, null);
    };
    // NOTE: src/lib/ship-operations.ts exists for AI-driven ship flows but has
    // no live producers today; if it gains call sites, subscribe to it here.
  }, [petEnabled, queryClient]);

  // 5. User activity (typing / pointer) + window visibility for idle & sleep.
  useEffect(() => {
    if (!petEnabled || typeof window === "undefined") return;
    let lastPointerAt = 0;
    const onKeyDown = () => petUserActivity("key");
    const onPointer = () => {
      const now = Date.now();
      if (now - lastPointerAt < POINTER_THROTTLE_MS) return;
      lastPointerAt = now;
      petUserActivity("pointer", now);
    };
    const onVisibility = () => petSetWindowHidden(document.hidden);
    const onBlur = () => petSetWindowHidden(true);
    const onFocus = () => petSetWindowHidden(false);
    window.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [petEnabled]);

  // 6. Persist identity changes (XP, name, fresh personality roll), debounced.
  useEffect(() => {
    if (!petEnabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribePetPersistence(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const petState = getPetPersistentState();
        if (!petState) return;
        // Keep the settings cache in step so other consumers (settings page)
        // see the new XP without a refetch.
        queryClient.setQueryData(queryKeys.settings, (prev: AppSettings | undefined) =>
          prev ? { ...prev, petState } : prev,
        );
        void api.updateSettings({ petState }).catch(() => {
          // Fire-and-forget: losing a debounce window of XP is acceptable.
        });
      }, PERSIST_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [petEnabled, queryClient]);

  // 7. Greeting shortly after boot + a slow ambient tick for idle/night lines.
  useEffect(() => {
    if (!petEnabled || typeof window === "undefined") return;
    // The message rate limiter caps greeting at once per app boot, so a
    // settings toggle or remount can't replay it.
    const greetTimer = setTimeout(() => petAmbientSay("greeting"), GREETING_DELAY_MS);
    const ambientTimer = setInterval(() => {
      const snapshot = getPetSnapshot();
      if (snapshot.night && (snapshot.mood === "idle" || snapshot.mood === "sleeping")) {
        petAmbientSay("night");
      } else if (snapshot.mood === "idle") {
        petAmbientSay("idle");
      }
    }, AMBIENT_TICK_MS);
    return () => {
      clearTimeout(greetTimer);
      clearInterval(ambientTimer);
    };
  }, [petEnabled]);

  // 8. Level-up chime (opt-in via pet sounds toggle).
  useEffect(() => {
    if (!petEnabled) return;
    return onPetLevelUp(() => playNotificationDing(petSoundsOn()));
  }, [petEnabled]);
}
