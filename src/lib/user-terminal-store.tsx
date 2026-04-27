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
  createTerminal: () => Promise<void>;
  killTerminal: (id: string) => Promise<void>;
  renameTerminal: (id: string, name: string) => Promise<void>;
  setPtyId: (terminalId: string, ptyId: string) => void;
  cycleNext: () => void;
  cyclePrev: () => void;
};

const UserTerminalContext = createContext<Ctx | null>(null);

export function UserTerminalProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const projectIdRef = useRef<string | null>(null);

  const killPty = async (id: string | null) => {
    if (!id) return;
    const electron = getElectron();
    if (!electron) return;
    await electron.pty.kill(id).catch(() => undefined);
  };

  const setProject = useCallback((next: Project | null) => {
    setProjectState((prev) => (prev?.id === next?.id ? prev : next));
  }, []);

  // Load terminals when switching to a different project; keep sessions alive
  // when project goes null (e.g. dashboard) so returning to the same project
  // preserves running PTYs.
  useEffect(() => {
    const id = project?.id ?? null;
    const prevId = projectIdRef.current;
    if (id === prevId) return;
    if (id === null) return; // detach view only; don't tear down sessions
    projectIdRef.current = id;

    setSessions((prev) => {
      for (const s of prev) void killPty(s.ptyId);
      return [];
    });
    setFocusedId(null);

    let cancelled = false;
    void (async () => {
      try {
        const { terminals } = await api.listUserTerminals(id);
        if (cancelled || projectIdRef.current !== id) return;
        setSessions(terminals.map((t) => ({ terminal: t, ptyId: null })));
        if (terminals.length > 0) setFocusedId(terminals[0]!.id);
      } catch {
        /* swallow */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const createTerminal = useCallback(async () => {
    if (!project) return;
    const { terminal } = await api.createUserTerminal(project.id, { cwd: project.path });
    setSessions((prev) => [...prev, { terminal, ptyId: null }]);
    setFocusedId(terminal.id);
    setPanelOpen(true);
  }, [project]);

  const killTerminal = useCallback(async (id: string) => {
    let neighborId: string | null = null;
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.terminal.id === id);
      const target = idx >= 0 ? prev[idx] : undefined;
      if (target) void killPty(target.ptyId);
      const next = prev.filter((s) => s.terminal.id !== id);
      if (next.length === 0) setPanelOpen(false);
      if (idx >= 0 && next.length > 0) {
        const pick = idx > 0 ? idx - 1 : 0;
        neighborId = next[pick].terminal.id;
      }
      return next;
    });
    setFocusedId((prev) => (prev === id ? neighborId : prev));
    try {
      await api.deleteUserTerminal(id);
    } catch {
      /* swallow */
    }
  }, []);

  const renameTerminal = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.terminal.id === id ? { ...s, terminal: { ...s.terminal, name: trimmed } } : s
      )
    );
    try {
      await api.renameUserTerminal(id, trimmed);
    } catch {
      /* swallow */
    }
  }, []);

  const setPtyId = useCallback((terminalId: string, ptyId: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.terminal.id === terminalId ? { ...s, ptyId } : s))
    );
  }, []);

  const togglePanel = useCallback(() => setPanelOpen((v) => !v), []);

  const focusTerminal = useCallback((id: string) => setFocusedId(id), []);

  const cycle = useCallback(
    (delta: 1 | -1) => {
      setSessions((prev) => {
        if (prev.length === 0) return prev;
        setPanelOpen(true);
        setFocusedId((curId) => {
          if (!curId) return prev[0]!.terminal.id;
          const idx = prev.findIndex((s) => s.terminal.id === curId);
          if (idx === -1) return prev[0]!.terminal.id;
          const nextIdx = (idx + delta + prev.length) % prev.length;
          return prev[nextIdx]!.terminal.id;
        });
        return prev;
      });
    },
    []
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
