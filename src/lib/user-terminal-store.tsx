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
import type { Project, UserTerminal } from "~/db/schema";

type Session = {
  terminal: UserTerminal;
  ptyId: string | null;
};

type Ctx = {
  project: Project | null;
  setProject: (project: Project | null) => void;
  panelOpen: boolean;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  sessions: Session[];
  focusedId: string | null;
  focusTerminal: (id: string) => void;
  createTerminal: (opts?: { name?: string; startCommand?: string | null }) => Promise<UserTerminal | null>;
  killTerminalsByStartCommand: (commands: string[]) => Promise<void>;
  killTerminal: (id: string) => Promise<void>;
  renameTerminal: (id: string, name: string) => Promise<void>;
  setPtyId: (terminalId: string, ptyId: string) => void;
  cycleNext: () => void;
  cyclePrev: () => void;
};

const UserTerminalContext = createContext<Ctx | null>(null);

export function UserTerminalProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<Project | null>(null);
  // Sessions for every project visited this app run, keyed by projectId.
  // Sessions stay alive across project switches so PTYs are not killed when
  // the user navigates away and back.
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
  const [focusedByProject, setFocusedByProject] = useState<Record<string, string | null>>({});
  const [panelOpenByProject, setPanelOpenByProject] = useState<Record<string, boolean>>({});
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

  const panelOpen = project ? (panelOpenByProject[project.id] ?? true) : false;
  const setPanelOpen = useCallback(
    (open: boolean) => {
      if (!project) return;
      const pid = project.id;
      setPanelOpenByProject((prev) => (prev[pid] === open ? prev : { ...prev, [pid]: open }));
    },
    [project]
  );
  const togglePanel = useCallback(() => {
    if (!project) return;
    const pid = project.id;
    setPanelOpenByProject((prev) => ({ ...prev, [pid]: !(prev[pid] ?? true) }));
  }, [project]);

  const setProject = useCallback((next: Project | null) => {
    setProjectState((prev) => (prev?.id === next?.id ? prev : next));
  }, []);

  // Lazy-load each project's persisted terminals the first time we see it.
  // Existing buckets are left alone so live PTYs survive project switches.
  useEffect(() => {
    const id = project?.id;
    if (!id) return;
    if (loadedProjectsRef.current.has(id)) return;
    loadedProjectsRef.current.add(id);

    let cancelled = false;
    void (async () => {
      try {
        const { terminals } = await api.listUserTerminals(id);
        if (cancelled) return;
        setSessionsByProject((prev) => {
          if (prev[id]) return prev; // a createTerminal call beat us to it
          return { ...prev, [id]: terminals.map((t) => ({ terminal: t, ptyId: null })) };
        });
        setFocusedByProject((prev) => {
          if (prev[id] !== undefined) return prev;
          return { ...prev, [id]: terminals[0]?.id ?? null };
        });
      } catch {
        loadedProjectsRef.current.delete(id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const sessions = project ? (sessionsByProject[project.id] ?? []) : [];
  const focusedId = project ? (focusedByProject[project.id] ?? null) : null;

  const updateSessions = useCallback(
    (projectId: string, fn: (prev: Session[]) => Session[]) => {
      setSessionsByProject((prev) => ({ ...prev, [projectId]: fn(prev[projectId] ?? []) }));
    },
    []
  );

  const setFocusFor = useCallback((projectId: string, id: string | null) => {
    setFocusedByProject((prev) => ({ ...prev, [projectId]: id }));
  }, []);

  const createTerminal = useCallback(
    async (opts?: { name?: string; startCommand?: string | null }) => {
      if (!project) return null;
      const projectId = project.id;
      const { terminal } = await api.createUserTerminal(projectId, {
        cwd: project.path,
        name: opts?.name,
        startCommand: opts?.startCommand ?? null,
      });
      updateSessions(projectId, (prev) => [...prev, { terminal, ptyId: null }]);
      setFocusFor(projectId, terminal.id);
      setPanelOpen(true);
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
      for (const [pid, list] of Object.entries(snapshot)) {
        const idx = list.findIndex((s) => s.terminal.id === id);
        if (idx === -1) continue;
        ownerProjectId = pid;
        killedPtyId = list[idx]!.ptyId;
        const filtered = list.filter((s) => s.terminal.id !== id);
        if (filtered.length > 0) {
          const pick = idx > 0 ? idx - 1 : 0;
          neighborId = filtered[pick]!.terminal.id;
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

      if (killedPtyId && electron) {
        await electron.pty.kill(killedPtyId).catch(() => undefined);
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

  const setPtyId = useCallback((terminalId: string, ptyId: string) => {
    setSessionsByProject((prev) => {
      const next = { ...prev };
      for (const [pid, list] of Object.entries(prev)) {
        if (!list.some((s) => s.terminal.id === terminalId)) continue;
        next[pid] = list.map((s) =>
          s.terminal.id === terminalId ? { ...s, ptyId } : s
        );
      }
      return next;
    });
  }, []);

  const killTerminalsByStartCommand = useCallback(
    async (commands: string[]) => {
      if (!project) return;
      const list = sessionsByProject[project.id] ?? [];
      const wanted = new Set(commands.map((c) => c.trim()).filter(Boolean));
      const targets = list.filter(
        (s) => s.terminal.startCommand && wanted.has(s.terminal.startCommand.trim())
      );
      await Promise.all(targets.map((s) => killTerminal(s.terminal.id)));
    },
    [project, sessionsByProject, killTerminal]
  );

  const focusTerminal = useCallback(
    (id: string) => {
      if (!project) return;
      setFocusFor(project.id, id);
    },
    [project, setFocusFor]
  );

  const cycle = useCallback(
    (delta: 1 | -1) => {
      if (!project) return;
      const list = sessionsByProject[project.id] ?? [];
      if (list.length === 0) return;
      setPanelOpen(true);
      const cur = focusedByProject[project.id] ?? null;
      const idx = cur ? list.findIndex((s) => s.terminal.id === cur) : -1;
      const nextIdx = idx === -1 ? 0 : (idx + delta + list.length) % list.length;
      setFocusFor(project.id, list[nextIdx]!.terminal.id);
    },
    [project, sessionsByProject, focusedByProject, setFocusFor]
  );

  const cycleNext = useCallback(() => cycle(1), [cycle]);
  const cyclePrev = useCallback(() => cycle(-1), [cycle]);

  const value = useMemo<Ctx>(
    () => ({
      project,
      setProject,
      panelOpen,
      togglePanel,
      setPanelOpen,
      sessions,
      focusedId,
      focusTerminal,
      createTerminal,
      killTerminal,
      killTerminalsByStartCommand,
      renameTerminal,
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
      focusedId,
      focusTerminal,
      createTerminal,
      killTerminal,
      killTerminalsByStartCommand,
      renameTerminal,
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
