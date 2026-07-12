// React glue for the multiplayer-pets client. Reads the reactive inputs the
// renderer already has — settings (the opt-in + my pet), the projects list
// (which repos have running sessions + their repo keys), and the currently
// viewed project — hashes the repo keys, and hands the DESIRED state to the
// singleton client. Returns the peers to render for the viewed project.
//
// Nothing here opens a socket directly; the client does, and only when enabled.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useProjects, useSettings } from "~/queries";
import { hashRepoKey } from "~/shared/repo-key";
import { petsWebSocketUrl } from "~/shared/academy";
import type { PetPeer } from "~/shared/pet-multiplayer-protocol";
import {
  getPetRoster,
  setPetMultiplayerDesired,
  subscribePetRoster,
  type PetMultiplayerDesired,
} from "./pet-multiplayer-client";

const DISABLED: PetMultiplayerDesired = {
  enabled: false,
  wsUrl: "",
  localPet: null,
  broadcastRooms: [],
  viewRoom: null,
};

/** Extract the project id from a `/projects/<id>` path, else null. */
function viewedProjectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function usePetMultiplayer(): PetPeer[] {
  const { data: settings } = useSettings();
  const { data: projects } = useProjects();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const viewedProjectId = viewedProjectIdFromPath(pathname);

  const enabled =
    !!settings?.petMultiplayerEnabled && !!settings?.petEnabled && !!settings?.petState;
  const localSpecies = settings?.petState?.species;
  const localName = settings?.petState?.name;
  // Progression drives the sprite's earned gear + molt star; broadcast it so
  // peers render our pet the way we see it, not a bare level-1 stand-in.
  const localLevel = settings?.petState?.level;
  const localPrestige = settings?.petState?.prestige;

  // Repos with a running session → broadcast rooms (sorted for stable deps).
  const broadcastKeys = useMemo(() => {
    if (!enabled || !projects) return [] as string[];
    const keys = new Set<string>();
    for (const p of projects) {
      if (p.repoKey && p.taskCounts.running > 0) keys.add(p.repoKey);
    }
    return [...keys].sort();
  }, [enabled, projects]);

  // The viewed project's repo → the room we display.
  const viewKey = useMemo(() => {
    if (!enabled || !projects || !viewedProjectId) return null;
    return projects.find((p) => p.id === viewedProjectId)?.repoKey ?? null;
  }, [enabled, projects, viewedProjectId]);

  const [viewRoom, setViewRoom] = useState<string | null>(null);

  const broadcastDep = broadcastKeys.join("\n");
  useEffect(() => {
    if (!enabled) {
      setPetMultiplayerDesired(DISABLED);
      setViewRoom(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [broadcastRooms, vr] = await Promise.all([
        Promise.all(broadcastKeys.map((k) => hashRepoKey(k))),
        viewKey ? hashRepoKey(viewKey) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setPetMultiplayerDesired({
        enabled: true,
        wsUrl: petsWebSocketUrl(),
        localPet:
          localSpecies && localName != null
            ? {
                species: localSpecies,
                name: localName,
                level: localLevel ?? 1,
                prestige: localPrestige ?? 0,
              }
            : null,
        broadcastRooms,
        viewRoom: vr,
      });
      setViewRoom(vr);
    })().catch(() => {
      // A hashing/crypto failure just means no pets — never surface it.
    });
    return () => {
      cancelled = true;
    };
    // broadcastDep encodes broadcastKeys; listing it keeps the array itself out of deps.
  }, [enabled, broadcastDep, viewKey, localSpecies, localName, localLevel, localPrestige]);

  // Ensure the socket is fully torn down if this hook ever unmounts.
  useEffect(() => () => setPetMultiplayerDesired(DISABLED), []);

  const subscribe = useCallback(
    (cb: () => void) => (viewRoom ? subscribePetRoster(viewRoom, cb) : () => {}),
    [viewRoom],
  );
  const getSnapshot = useCallback(() => getPetRoster(viewRoom), [viewRoom]);
  const roster = useSyncExternalStore(subscribe, getSnapshot);

  // The client already drops our own PEER_ID, but our pet can still echo back
  // from a second app instance or a stale presence the relay hasn't reaped —
  // both carry a different id but our pet's name. Hide anything sharing our
  // name so we never see ourselves in the crowd.
  const selfName = localName?.trim().toLowerCase();
  return useMemo(
    () =>
      selfName ? roster.filter((p) => p.name.trim().toLowerCase() !== selfName) : roster,
    [roster, selfName],
  );
}
