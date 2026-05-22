import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "~/lib/api";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";
import {
  DiagramDialog,
  type DiagramDialogPayload,
} from "~/components/views/DiagramDialog";
import { DIAGRAM_FORMATS } from "~/shared/diagram";

type DiagramContextValue = {
  hasDiagram: (taskId: string) => boolean;
  openDiagram: (taskId: string) => Promise<void>;
  hydrateProject: (projectId: string) => Promise<void>;
};

const DiagramContext = createContext<DiagramContextValue | null>(null);

function isDiagramFormat(value: unknown): value is DiagramDialogPayload["format"] {
  return typeof value === "string" && (DIAGRAM_FORMATS as readonly string[]).includes(value);
}

function parseDiagramEvent(event: ServerEvent): DiagramDialogPayload | null {
  if (event.type !== "diagram:show") return null;
  const id = typeof event.id === "string" ? event.id : "";
  const taskId = typeof event.taskId === "string" ? event.taskId : "";
  const projectId = typeof event.projectId === "string" ? event.projectId : "";
  const source = typeof event.source === "string" ? event.source : "";
  const title = typeof event.title === "string" ? event.title : null;
  const format = isDiagramFormat(event.format) ? event.format : "mermaid";
  if (!id || !taskId || !projectId || !source.trim()) return null;
  return { id, taskId, projectId, title, source, format };
}

export function useDiagrams(): DiagramContextValue {
  const ctx = useContext(DiagramContext);
  if (!ctx) {
    throw new Error("useDiagrams must be used within DiagramDialogHost");
  }
  return ctx;
}

export function useSyncProjectDiagrams(projectId: string | undefined) {
  const { hydrateProject } = useDiagrams();
  useEffect(() => {
    if (!projectId) return;
    void hydrateProject(projectId);
  }, [projectId, hydrateProject]);
}

export function DiagramDialogHost({ children }: { children?: ReactNode }) {
  const [byTaskId, setByTaskId] = useState<Record<string, DiagramDialogPayload>>({});
  const [openPayload, setOpenPayload] = useState<DiagramDialogPayload | null>(null);

  const upsertDiagram = useCallback((payload: DiagramDialogPayload) => {
    setByTaskId((current) => ({ ...current, [payload.taskId]: payload }));
  }, []);

  const onEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "task:deleted") {
        const taskId = typeof event.id === "string" ? event.id : "";
        if (!taskId) return;
        setByTaskId((current) => {
          if (!current[taskId]) return current;
          const next = { ...current };
          delete next[taskId];
          return next;
        });
        setOpenPayload((current) => (current?.taskId === taskId ? null : current));
        return;
      }

      const next = parseDiagramEvent(event);
      if (!next) return;
      upsertDiagram(next);
      setOpenPayload(next);
    },
    [upsertDiagram],
  );

  useServerEvents(onEvent);

  const hydrateProject = useCallback(
    async (projectId: string) => {
      const { diagrams } = await api.listDiagrams(projectId);
      setByTaskId((current) => {
        const next = { ...current };
        for (const diagram of diagrams) {
          next[diagram.taskId] = diagram;
        }
        return next;
      });
    },
    [],
  );

  const openDiagram = useCallback(
    async (taskId: string) => {
      const cached = byTaskId[taskId];
      if (cached) {
        setOpenPayload(cached);
        return;
      }
      try {
        const { diagram } = await api.getDiagram(taskId);
        upsertDiagram(diagram);
        setOpenPayload(diagram);
      } catch {
        /* ignore missing diagram */
      }
    },
    [byTaskId, upsertDiagram],
  );

  const value = useMemo<DiagramContextValue>(
    () => ({
      hasDiagram: (taskId: string) => !!byTaskId[taskId],
      openDiagram,
      hydrateProject,
    }),
    [byTaskId, openDiagram, hydrateProject],
  );

  return (
    <DiagramContext.Provider value={value}>
      {children}
      <DiagramDialog payload={openPayload} onClose={() => setOpenPayload(null)} />
    </DiagramContext.Provider>
  );
}
