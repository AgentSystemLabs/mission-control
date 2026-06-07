import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { activateSandboxScope, scopeIdToActivate } from "~/lib/activate-sandbox-scope";
import { playNotificationDing } from "~/lib/notification-sound";
import { api } from "~/lib/api";
import { useSandboxes, useSettings } from "~/queries";
import {
  DIAGRAM_NOTIFICATION_OPEN_EVENT,
  clearPendingNotificationOpen,
  readPendingDiagramOpen,
  type PendingNotificationOpen,
} from "~/lib/session-notification-store";
import { persistDiagramReadyServerEvent } from "~/lib/use-diagram-ready-notifications";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";
import {
  DiagramDialog,
  type DiagramDialogPayload,
  type DiagramDialogSession,
} from "~/components/views/DiagramDialog";
import { DIAGRAM_FORMATS } from "~/shared/diagram";
import { LOCAL_SCOPE_ID, normalizeScopeId } from "~/shared/sandbox";

type DiagramContextValue = {
  hasDiagram: (taskId: string) => boolean;
  openDiagram: (taskId: string, diagramId?: string) => Promise<void>;
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

function appendDiagram(
  current: DiagramDialogPayload[],
  next: DiagramDialogPayload,
): DiagramDialogPayload[] {
  if (current.some((diagram) => diagram.id === next.id)) return current;
  return [...current, next];
}

function toSession(
  taskId: string,
  projectId: string,
  diagrams: DiagramDialogPayload[],
  activeId?: string,
): DiagramDialogSession | null {
  if (diagrams.length === 0) return null;
  const resolvedActiveId =
    activeId && diagrams.some((diagram) => diagram.id === activeId)
      ? activeId
      : diagrams[diagrams.length - 1]!.id;
  return { taskId, projectId, diagrams, activeId: resolvedActiveId };
}

function groupDiagramsByTask(
  diagrams: Array<DiagramDialogPayload & { createdAt?: number }>,
): Record<string, DiagramDialogPayload[]> {
  const grouped: Record<string, DiagramDialogPayload[]> = {};
  const sorted = [...diagrams].sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );
  for (const diagram of sorted) {
    const { createdAt: _createdAt, ...payload } = diagram;
    grouped[diagram.taskId] = appendDiagram(grouped[diagram.taskId] ?? [], payload);
  }
  return grouped;
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
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const { data: sandboxState } = useSandboxes();
  const soundEnabled = settings?.notificationSoundEnabled ?? true;
  const [byTaskId, setByTaskId] = useState<Record<string, DiagramDialogPayload[]>>({});
  const [openSession, setOpenSession] = useState<DiagramDialogSession | null>(null);

  const upsertDiagram = useCallback((payload: DiagramDialogPayload) => {
    setByTaskId((current) => ({
      ...current,
      [payload.taskId]: appendDiagram(current[payload.taskId] ?? [], payload),
    }));
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
        setOpenSession((current) => (current?.taskId === taskId ? null : current));
        return;
      }

      const next = parseDiagramEvent(event);
      if (!next) return;
      upsertDiagram(next);
      if (persistDiagramReadyServerEvent(event)) {
        playNotificationDing(soundEnabled);
      }
    },
    [upsertDiagram, soundEnabled],
  );

  useServerEvents(onEvent);

  const hydrateProject = useCallback(async (projectId: string) => {
    const { diagrams } = await api.listDiagrams(projectId);
    const grouped = groupDiagramsByTask(diagrams);
    setByTaskId((current) => {
      const next = { ...current };
      for (const [taskId, taskDiagrams] of Object.entries(grouped)) {
        next[taskId] = taskDiagrams;
      }
      return next;
    });
  }, []);

  const openDiagram = useCallback(
    async (taskId: string, diagramId?: string) => {
      const cached = byTaskId[taskId];
      if (cached?.length) {
        setOpenSession(toSession(taskId, cached[0]!.projectId, cached, diagramId));
        return;
      }
      try {
        const { diagrams } = await api.getDiagrams(taskId);
        if (diagrams.length === 0) return;
        const grouped = groupDiagramsByTask(diagrams);
        const taskDiagrams = grouped[taskId] ?? [];
        setByTaskId((current) => ({ ...current, [taskId]: taskDiagrams }));
        setOpenSession(
          toSession(taskId, diagrams[0]!.projectId, taskDiagrams, diagramId),
        );
      } catch {
        /* ignore missing diagram */
      }
    },
    [byTaskId],
  );

  const openRequestedDiagram = useCallback(
    async (request: PendingNotificationOpen) => {
      if (request.kind !== "diagram-ready" || !request.diagramId) return false;

      let resolvedScopeId = normalizeScopeId(request.scopeId);
      try {
        const { task } = await api.getTask(request.taskId);
        if (task?.projectId === request.projectId) {
          resolvedScopeId = normalizeScopeId(task.scopeId);
        }
      } catch {
        /* keep scope from notification */
      }

      const activateTo = scopeIdToActivate(sandboxState, request.projectId, resolvedScopeId);
      const globalActiveScopeId = normalizeScopeId(sandboxState?.activeScopeId ?? LOCAL_SCOPE_ID);

      if (globalActiveScopeId !== activateTo) {
        const switched = await activateSandboxScope(queryClient, activateTo);
        if (!switched) clearPendingNotificationOpen(request);
        return false;
      }

      await openDiagram(request.taskId, request.diagramId);
      clearPendingNotificationOpen(request);
      return true;
    },
    [openDiagram, queryClient, sandboxState],
  );

  useEffect(() => {
    const pending = readPendingDiagramOpen();
    if (pending) void openRequestedDiagram(pending);
  }, [openRequestedDiagram, sandboxState?.activeScopeId]);

  useEffect(() => {
    const onOpenRequest = (event: Event) => {
      const request = (event as CustomEvent<PendingNotificationOpen>).detail;
      if (request) void openRequestedDiagram(request);
    };
    window.addEventListener(DIAGRAM_NOTIFICATION_OPEN_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener(DIAGRAM_NOTIFICATION_OPEN_EVENT, onOpenRequest);
    };
  }, [openRequestedDiagram]);

  const value = useMemo<DiagramContextValue>(
    () => ({
      hasDiagram: (taskId: string) => (byTaskId[taskId]?.length ?? 0) > 0,
      openDiagram,
      hydrateProject,
    }),
    [byTaskId, openDiagram, hydrateProject],
  );

  return (
    <DiagramContext.Provider value={value}>
      {children}
      <DiagramDialog
        session={openSession}
        onClose={() => setOpenSession(null)}
        onSelectDiagram={(id) =>
          setOpenSession((current) =>
            current ? { ...current, activeId: id } : current,
          )
        }
      />
    </DiagramContext.Provider>
  );
}
