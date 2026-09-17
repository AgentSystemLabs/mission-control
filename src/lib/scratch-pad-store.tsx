import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { ScratchPadModal } from "~/components/views/ScratchPadModal";
import { projectIdFromPath } from "~/lib/project-id-from-path";
import { useHotkey } from "~/lib/use-hotkey";

/** What the scratch-pad modal opens on: the project's most recent pad, a fresh blank one, or a specific pad. */
export type ScratchPadTarget =
  | { type: "latest" }
  | { type: "new" }
  | { type: "pad"; padId: string };

type OpenState = { projectId: string; target: ScratchPadTarget };

type Ctx = {
  /** Current project derived from the route; null outside a project page. */
  projectId: string | null;
  isOpen: boolean;
  openLatest: () => void;
  openNew: () => void;
  openPad: (padId: string) => void;
  close: () => void;
};

const ScratchPadContext = createContext<Ctx | null>(null);

/**
 * Owns the scratch-pad modal's open state so the global hotkey, the top-bar
 * button dropdown, and the modal stay in sync. Mirrors PromptSearchProvider.
 * The project id is captured at open time so the modal keeps saving to the
 * right project; navigating to another project closes it.
 */
export function ScratchPadProvider({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const projectId = projectIdFromPath(path);
  const [openState, setOpenState] = useState<OpenState | null>(null);

  const close = useCallback(() => setOpenState(null), []);
  const openLatest = useCallback(() => {
    if (projectId) setOpenState({ projectId, target: { type: "latest" } });
  }, [projectId]);
  const openNew = useCallback(() => {
    if (projectId) setOpenState({ projectId, target: { type: "new" } });
  }, [projectId]);
  const openPad = useCallback(
    (padId: string) => {
      if (projectId) setOpenState({ projectId, target: { type: "pad", padId } });
    },
    [projectId],
  );

  // Leaving the pad's project (project picker, nav) closes the modal rather
  // than leaving it editing a pad from a page that's no longer on screen.
  useEffect(() => {
    setOpenState((s) => (s && s.projectId !== projectId ? null : s));
  }, [projectId]);

  // Capture phase so the shortcut still fires when a session terminal (xterm)
  // has focus and would otherwise swallow the keydown.
  useHotkey(
    "scratch.toggle",
    () => {
      if (openState) setOpenState(null);
      else if (projectId) setOpenState({ projectId, target: { type: "latest" } });
    },
    { capture: true },
  );

  const value = useMemo<Ctx>(
    () => ({ projectId, isOpen: openState !== null, openLatest, openNew, openPad, close }),
    [projectId, openState, openLatest, openNew, openPad, close],
  );

  const targetKey =
    openState === null
      ? null
      : openState.target.type === "pad"
        ? `pad:${openState.target.padId}`
        : openState.target.type;

  return (
    <ScratchPadContext.Provider value={value}>
      {children}
      {openState && (
        <ScratchPadModal
          // Remount per target so a switch (dropdown pick, "new") starts from
          // fresh local state; the unmount flush saves the previous buffer.
          key={`${openState.projectId}:${targetKey}`}
          projectId={openState.projectId}
          target={openState.target}
          onClose={close}
        />
      )}
    </ScratchPadContext.Provider>
  );
}

export function useScratchPad(): Ctx {
  const ctx = useContext(ScratchPadContext);
  if (!ctx) throw new Error("useScratchPad must be used within ScratchPadProvider");
  return ctx;
}
