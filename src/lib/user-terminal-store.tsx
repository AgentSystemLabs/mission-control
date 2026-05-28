import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { getElectron } from "./electron";
import {
  hasRunningLaunchForProject as projectHasRunningLaunch,
  runningLaunchScopeKeysForProject,
} from "./project-launch-running";
import { prefetchTerminalModules } from "./prefetch-terminal-modules";
import {
  discardUserTerminalWarmSlot,
  prepareUserTerminalWarmSlot,
  replenishUserTerminalWarmSlot,
  takeUserTerminalWarmSlot,
} from "./user-terminal-warm-pool";
import type { Project, UserTerminal } from "~/db/schema";
import { worktreeScopeKey } from "~/shared/worktrees";

type ScopedProject = Project & { activeWorktreeId?: string | null };

type Session = {
  terminal: UserTerminal;
  ptyId: string | null;
};

type Ctx = {
  project: ScopedProject | null;
  setProject: (project: ScopedProject | null) => void;
  panelOpen: boolean;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  sessions: Session[];
  sessionsByScope: Record<string, Session[]>;
  runningProjectIds: Set<string>;
  runningWorktreeIds: Set<string>;
  hasRunningLaunchForProject: (
    projectId: string,
    launchCommandsRaw: string | null | undefined
  ) => boolean;
  runningLaunchWorktreeIdsForProject: (
    projectId: string,
    launchCommandsRaw: string | null | undefined
  ) => Set<string>;
  focusedId: string | null;
  focusTerminal: (id: string) => void;
  createTerminal: (opts?: {
    name?: string;
    startCommand?: string | null;
    project?: ScopedProject;
  }) => Promise<UserTerminal | null>;
  killTerminalsByStartCommand: (
    commands: string[],
    opts?: { ports?: number[] }
  ) => Promise<void>;
  killTerminal: (id: string) => Promise<void>;
  hiddenIds: Set<string>;
  toggleHidden: (id: string) => void;
  renameTerminal: (id: string, name: string) => Promise<void>;
  updateLaunchUrl: (url: string) => Promise<void>;
  setPtyId: (terminalId: string, ptyId: string | null) => void;
  cycleNext: () => void;
  cyclePrev: () => void;
};

const UserTerminalContext = createContext<Ctx | null>(null);

function scopeKeyForProject(project: ScopedProject): string {
  return worktreeScopeKey(project.id, project.activeWorktreeId);
}

export function UserTerminalProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<ScopedProject | null>(null);
  // Sessions for every project visited this app run, keyed by projectId.
  // Sessions stay alive across project switches so PTYs are not killed when
  // the user navigates away and back.
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
  const [focusedByProject, setFocusedByProject] = useState<Record<string, string | null>>({});
  const [hiddenIdsByProject, setHiddenIdsByProject] = useState<Record<string, string[]>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("mc.userTerminalHiddenIds");
      return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "mc.userTerminalHiddenIds",
        JSON.stringify(hiddenIdsByProject)
      );
    } catch {
      /* quota or disabled */
    }
  }, [hiddenIdsByProject]);
  const [panelOpenByProject, setPanelOpenByProject] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("mc.userTerminalPanelOpen");
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "mc.userTerminalPanelOpen",
        JSON.stringify(panelOpenByProject)
      );
    } catch {
      /* quota or disabled */
    }
  }, [panelOpenByProject]);
  const loadedProjectsRef = useRef<Set<string>>(new Set());
  // Mirror of sessionsByProject. killTerminal reads this synchronously instead
  // of via a setState updater, since React 18 skips eager-state evaluation
  // when the fiber already has pending lanes (e.g. when the same click also
  // triggered a focus setState first), making closure mutation inside the
  // updater unreliable.
  const sessionsByProjectRef = useRef<Record<string, Session[]>>({});
  useEffect(() => {
    sessionsByProjectRef.current = sessionsByProject;
  }, [sessionsByProject]);

  const scopeKey = project ? scopeKeyForProject(project) : null;
  const panelOpen = scopeKey ? (panelOpenByProject[scopeKey] ?? false) : false;
  const setPanelOpen = useCallback(
    (open: boolean) => {
      if (!project) return;
      const key = scopeKeyForProject(project);
      setPanelOpenByProject((prev) => (prev[key] === open ? prev : { ...prev, [key]: open }));
    },
    [project]
  );
  const togglePanel = useCallback(() => {
    if (!project) return;
    const key = scopeKeyForProject(project);
    setPanelOpenByProject((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }, [project]);

  const setProject = useCallback((next: ScopedProject | null) => {
    setProjectState((prev) =>
      prev?.id === next?.id && prev?.activeWorktreeId === next?.activeWorktreeId ? prev : next
    );
  }, []);

  // Lazy-load each project's persisted terminals the first time we see it.
  // Existing buckets are left alone so live PTYs survive project switches.
  useEffect(() => {
    const id = project?.id;
    const key = project ? scopeKeyForProject(project) : null;
    if (!id || !key) return;
    if (loadedProjectsRef.current.has(key)) return;
    loadedProjectsRef.current.add(key);

    let cancelled = false;
    void (async () => {
      try {
        const { terminals } = await api.listUserTerminals(id, project.activeWorktreeId ?? null);
        if (cancelled) return;
        setSessionsByProject((prev) => {
          if (prev[key]) return prev; // a createTerminal call beat us to it
          return { ...prev, [key]: terminals.map((t) => ({ terminal: t, ptyId: null })) };
        });
        setFocusedByProject((prev) => {
          if (prev[key] !== undefined) return prev;
          return { ...prev, [key]: terminals[0]?.id ?? null };
        });
      } catch {
        loadedProjectsRef.current.delete(key);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const warmPrepareKey = project?.path
    ? `${scopeKeyForProject(project)}:${project.path}`
    : null;
  useEffect(() => {
    if (!project?.path || !warmPrepareKey) return;
    void prefetchTerminalModules();
    void prepareUserTerminalWarmSlot({ project, cwd: project.path });
    return () => {
      void discardUserTerminalWarmSlot();
    };
  }, [warmPrepareKey, project]);

  const sessions = scopeKey ? (sessionsByProject[scopeKey] ?? []) : [];
  const runningProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [key, list] of Object.entries(sessionsByProject)) {
      if (list.some((s) => s.ptyId)) ids.add(key.split(":")[0]!);
    }
    return ids;
  }, [sessionsByProject]);
  const runningWorktreeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [key, list] of Object.entries(sessionsByProject)) {
      if (list.some((s) => s.ptyId)) ids.add(key);
    }
    return ids;
  }, [sessionsByProject]);
  const focusedId = scopeKey ? (focusedByProject[scopeKey] ?? null) : null;
  const hiddenIds = useMemo<Set<string>>(
    () => new Set(scopeKey ? (hiddenIdsByProject[scopeKey] ?? []) : []),
    [scopeKey, hiddenIdsByProject]
  );
  const toggleHidden = useCallback(
    (id: string) => {
      if (!project) return;
      const key = scopeKeyForProject(project);
      const hiddenIds = hiddenIdsByProject[key] ?? [];
      const hiding = !hiddenIds.includes(id);
      setHiddenIdsByProject((prev) => {
        const cur = prev[key] ?? [];
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        return { ...prev, [key]: next };
      });

      if (!hiding) {
        setPanelOpenByProject((prev) => (prev[key] === true ? prev : { ...prev, [key]: true }));
        return;
      }

      const visibleAfterHide = (sessionsByProjectRef.current[key] ?? []).filter(
        (s) => s.terminal.id !== id && !hiddenIds.includes(s.terminal.id)
      );
      if (visibleAfterHide.length === 0) {
        setPanelOpenByProject((prev) =>
          prev[key] === false ? prev : { ...prev, [key]: false }
        );
      }
    },
    [hiddenIdsByProject, project]
  );

  const updateSessions = useCallback(
    (projectId: string, fn: (prev: Session[]) => Session[]) => {
      setSessionsByProject((prev) => ({ ...prev, [projectId]: fn(prev[projectId] ?? []) }));
    },
    []
  );

  const setFocusFor = useCallback((projectId: string, id: string | null) => {
    setFocusedByProject((prev) => (prev[projectId] === id ? prev : { ...prev, [projectId]: id }));
  }, []);

  const createTerminal = useCallback(
    async (opts?: { name?: string; startCommand?: string | null; project?: ScopedProject }) => {
      const targetProject = opts?.project ?? project;
      if (!targetProject) return null;
      const projectId = targetProject.id;
      const key = scopeKeyForProject(targetProject);
      const cwd = targetProject.path;
      const startCommand = opts?.startCommand ?? null;

      if (!startCommand && cwd && getElectron()) {
        const warmSlot = takeUserTerminalWarmSlot(cwd);
        if (warmSlot) {
          const draftTerminal: UserTerminal = {
            ...warmSlot.draftTerminal,
            name: opts?.name?.trim() || warmSlot.draftTerminal.name,
          };
          updateSessions(key, (prev) => [...prev, { terminal: draftTerminal, ptyId: warmSlot.ptyId }]);
          setFocusFor(key, draftTerminal.id);
          setPanelOpenByProject((prev) => ({ ...prev, [key]: true }));

          void (async () => {
            try {
              const { terminal } = await api.createUserTerminal(projectId, {
                id: warmSlot.clientTerminalId,
                cwd,
                name: opts?.name,
                worktreeId: targetProject.activeWorktreeId ?? null,
              });
              updateSessions(key, (prev) =>
                prev.map((s) =>
                  s.terminal.id === warmSlot.clientTerminalId
                    ? { terminal, ptyId: warmSlot.ptyId }
                    : s,
                ),
              );
              replenishUserTerminalWarmSlot({ project: targetProject, cwd });
            } catch {
              const electron = getElectron();
              if (electron) await electron.pty.kill(warmSlot.ptyId).catch(() => undefined);
              updateSessions(key, (prev) =>
                prev.filter((s) => s.terminal.id !== warmSlot.clientTerminalId),
              );
              replenishUserTerminalWarmSlot({ project: targetProject, cwd });
            }
          })();
          return draftTerminal;
        }
      }

      const { terminal } = await api.createUserTerminal(projectId, {
        cwd,
        name: opts?.name,
        startCommand,
        worktreeId: targetProject.activeWorktreeId ?? null,
      });
      updateSessions(key, (prev) => [...prev, { terminal, ptyId: null }]);
      setFocusFor(key, terminal.id);
      setPanelOpenByProject((prev) => ({ ...prev, [key]: true }));
      if (!startCommand && cwd) {
        replenishUserTerminalWarmSlot({ project: targetProject, cwd });
      }
      return terminal;
    },
    [project, updateSessions, setFocusFor]
  );

  const killTerminal = useCallback(
    async (id: string) => {
      const electron = getElectron();
      // Resolve owner + neighbor synchronously from the latest snapshot. Doing
      // this inside a setState updater breaks when the fiber has pending lanes
      // (the updater would run lazily, leaving the closure vars null).
      const snapshot = sessionsByProjectRef.current;
      let ownerProjectId: string | null = null;
      let killedPtyId: string | null = null;
      let neighborId: string | null = null;
      let lastTerminal = false;
      for (const [pid, list] of Object.entries(snapshot)) {
        const idx = list.findIndex((s) => s.terminal.id === id);
        if (idx === -1) continue;
        ownerProjectId = pid;
        killedPtyId = list[idx]!.ptyId;
        const filtered = list.filter((s) => s.terminal.id !== id);
        if (filtered.length > 0) {
          const pick = idx > 0 ? idx - 1 : 0;
          neighborId = filtered[pick]!.terminal.id;
        } else {
          lastTerminal = true;
        }
        break;
      }
      if (!ownerProjectId) return;

      setSessionsByProject((prev) => ({
        ...prev,
        [ownerProjectId!]: (prev[ownerProjectId!] ?? []).filter(
          (s) => s.terminal.id !== id
        ),
      }));
      setFocusedByProject((prev) => {
        if (prev[ownerProjectId!] !== id) return prev;
        return { ...prev, [ownerProjectId!]: neighborId };
      });
      setHiddenIdsByProject((prev) => {
        const cur = prev[ownerProjectId!];
        if (!cur || !cur.includes(id)) return prev;
        return { ...prev, [ownerProjectId!]: cur.filter((x) => x !== id) };
      });
      if (lastTerminal) {
        setPanelOpenByProject((prev) =>
          prev[ownerProjectId!] === false
            ? prev
            : { ...prev, [ownerProjectId!]: false }
        );
      }

      if (killedPtyId && electron) {
        await electron.pty.kill(killedPtyId).catch(() => undefined);
      } else if (killedPtyId) {
        await api.killRemotePty(killedPtyId).catch(() => undefined);
      }
      try {
        await api.deleteUserTerminal(id);
      } catch {
        /* swallow */
      }
    },
    []
  );

  const renameTerminal = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSessionsByProject((prev) => {
      const next = { ...prev };
      for (const [pid, list] of Object.entries(prev)) {
        if (!list.some((s) => s.terminal.id === id)) continue;
        next[pid] = list.map((s) =>
          s.terminal.id === id ? { ...s, terminal: { ...s.terminal, name: trimmed } } : s
        );
      }
      return next;
    });
    try {
      await api.renameUserTerminal(id, trimmed);
    } catch {
      /* swallow */
    }
  }, []);

  const updateLaunchUrl = useCallback(
    async (url: string) => {
      if (!project) return;
      const normalized = url.replace(/\[::1\]/, "localhost");
      if (project.launchUrl === normalized) return;
      setProjectState((prev) =>
        prev?.id === project.id ? { ...prev, launchUrl: normalized, updatedAt: Date.now() } : prev
      );
      try {
        await api.updateProjectLaunchUrl(project.id, normalized);
      } catch {
        /* swallow */
      }
    },
    [project]
  );

  const setPtyId = useCallback((terminalId: string, ptyId: string | null) => {
    setSessionsByProject((prev) => {
      let next = prev;
      let changed = false;
      for (const [pid, list] of Object.entries(prev)) {
        if (!list.some((s) => s.terminal.id === terminalId)) continue;
        const updated = list.map((s) => {
          if (s.terminal.id !== terminalId) return s;
          if (s.ptyId === ptyId) return s;
          changed = true;
          return { ...s, ptyId };
        });
        if (updated !== list && changed) {
          next = next === prev ? { ...prev } : next;
          next[pid] = updated;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const killTerminalsByStartCommand = useCallback(
    async (commands: string[], opts?: { ports?: number[] }) => {
      if (!project) return;
      const electron = getElectron();
      const list = sessionsByProject[scopeKeyForProject(project)] ?? [];
      const wanted = new Set(commands.map((c) => c.trim()).filter(Boolean));
      if (wanted.size === 0) return;
      const targets = list.filter(
        (s) => s.terminal.startCommand && wanted.has(s.terminal.startCommand.trim())
      );
      await Promise.all(targets.map((s) => killTerminal(s.terminal.id)));
      await electron?.pty
        .killLaunchProcesses({
          cwd: project.path,
          commands: [...wanted],
          ports: opts?.ports ?? [],
        })
        .catch(() => undefined);
    },
    [project, sessionsByProject, killTerminal]
  );

  const focusTerminal = useCallback(
    (id: string) => {
      if (!project) return;
      setFocusFor(scopeKeyForProject(project), id);
    },
    [project, setFocusFor]
  );

  const cycle = useCallback(
    (delta: 1 | -1) => {
      if (!project) return;
      // No-op when the panel is closed — don't open it as a side effect of cycling.
      const key = scopeKeyForProject(project);
      if (!(panelOpenByProject[key] ?? false)) return;
      const list = sessionsByProject[key] ?? [];
      if (list.length === 0) return;
      const cur = focusedByProject[key] ?? null;
      const idx = cur ? list.findIndex((s) => s.terminal.id === cur) : -1;
      const nextIdx = idx === -1 ? 0 : (idx + delta + list.length) % list.length;
      setFocusFor(key, list[nextIdx]!.terminal.id);
    },
    [project, panelOpenByProject, sessionsByProject, focusedByProject, setFocusFor]
  );

  const cycleNext = useCallback(() => cycle(1), [cycle]);
  const cyclePrev = useCallback(() => cycle(-1), [cycle]);

  const hasRunningLaunchForProject = useCallback(
    (projectId: string, launchCommandsRaw: string | null | undefined) =>
      projectHasRunningLaunch(projectId, launchCommandsRaw, sessionsByProject),
    [sessionsByProject]
  );
  const runningLaunchWorktreeIdsForProject = useCallback(
    (projectId: string, launchCommandsRaw: string | null | undefined) =>
      runningLaunchScopeKeysForProject(projectId, launchCommandsRaw, sessionsByProject),
    [sessionsByProject]
  );

  const value = useMemo<Ctx>(
    () => ({
      project,
      setProject,
      panelOpen,
      togglePanel,
      setPanelOpen,
      sessions,
      sessionsByScope: sessionsByProject,
      runningProjectIds,
      runningWorktreeIds,
      hasRunningLaunchForProject,
      runningLaunchWorktreeIdsForProject,
      focusedId,
      focusTerminal,
      createTerminal,
      killTerminal,
      hiddenIds,
      toggleHidden,
      killTerminalsByStartCommand,
      renameTerminal,
      updateLaunchUrl,
      setPtyId,
      cycleNext,
      cyclePrev,
    }),
    [
      project,
      setProject,
      panelOpen,
      togglePanel,
      sessions,
      sessionsByProject,
      runningProjectIds,
      runningWorktreeIds,
      hasRunningLaunchForProject,
      runningLaunchWorktreeIdsForProject,
      focusedId,
      focusTerminal,
      createTerminal,
      killTerminal,
      hiddenIds,
      toggleHidden,
      killTerminalsByStartCommand,
      renameTerminal,
      updateLaunchUrl,
      setPtyId,
      cycleNext,
      cyclePrev,
    ]
  );

  return (
    <UserTerminalContext.Provider value={value}>{children}</UserTerminalContext.Provider>
  );
}

export function useUserTerminals() {
  const ctx = useContext(UserTerminalContext);
  if (!ctx) throw new Error("useUserTerminals must be used inside UserTerminalProvider");
  return ctx;
}
