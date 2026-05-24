import { useCallback, useEffect, useState } from "react";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";
import {
  SESSION_FINISH_NOTIFICATIONS_STORAGE_KEY,
  SESSION_NOTIFICATIONS_CHANGED_EVENT,
  loadAppNotifications,
  mergeDiagramReadyNotification,
  pruneAppNotification,
  pruneAppNotifications,
  saveAppNotifications,
  type AppNotification,
  type DiagramReadyNotification,
  type SessionFinishNotification,
  type SessionNotificationPruneTarget,
} from "~/lib/session-notification-store";

export function useDiagramReadyNotifications() {
  const [notifications, setNotifications] = useState<DiagramReadyNotification[]>(() =>
    loadAppNotifications().filter(
      (notification): notification is DiagramReadyNotification =>
        notification.kind === "diagram-ready",
    ),
  );

  const syncFromStorage = useCallback(() => {
    setNotifications(
      loadAppNotifications().filter(
        (notification): notification is DiagramReadyNotification =>
          notification.kind === "diagram-ready",
      ),
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_FINISH_NOTIFICATIONS_STORAGE_KEY) {
        syncFromStorage();
      }
    };
    window.addEventListener(SESSION_NOTIFICATIONS_CHANGED_EVENT, syncFromStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SESSION_NOTIFICATIONS_CHANGED_EVENT, syncFromStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncFromStorage]);

  const clearNotification = useCallback((notification: DiagramReadyNotification) => {
    setNotifications((prev) => {
      const next = prev.filter(
        (item) =>
          !(
            item.diagramId === notification.diagramId &&
            item.projectId === notification.projectId
          ),
      );
      if (next.length === prev.length) return prev;
      saveAppNotifications(
        loadAppNotifications().filter(
          (item) =>
            !(
              item.kind === "diagram-ready" &&
              item.diagramId === notification.diagramId &&
              item.projectId === notification.projectId
            ),
        ),
      );
      return next;
    });
  }, []);

  const pruneNotifications = useCallback((target: SessionNotificationPruneTarget) => {
    setNotifications((prev) => {
      const all = loadAppNotifications();
      const nextAll = pruneAppNotifications(all, target);
      if (nextAll === all) return prev;
      saveAppNotifications(nextAll);
      return nextAll.filter(
        (notification): notification is DiagramReadyNotification =>
          notification.kind === "diagram-ready",
      );
    });
  }, []);

  const handler = useCallback(
    (event: ServerEvent) => {
      if (event.type === "task:deleted") {
        const taskId = String(event.id ?? "");
        const projectId = typeof event.projectId === "string" ? event.projectId : undefined;
        if (taskId) pruneNotifications({ type: "task", taskId, projectId });
        return;
      }

      if (event.type === "project:deleted") {
        const projectId = String(event.id ?? "");
        if (projectId) pruneNotifications({ type: "project", projectId });
        return;
      }

      if (event.type === "worktree:deleted") {
        const worktreeId = String(event.id ?? "");
        const projectId = String(event.projectId ?? "");
        if (worktreeId && projectId) {
          pruneNotifications({ type: "worktree", projectId, worktreeId });
        }
        return;
      }

      if (event.type !== "diagram:show") return;

      const diagramId = typeof event.id === "string" ? event.id : "";
      const taskId = typeof event.taskId === "string" ? event.taskId : "";
      const projectId = typeof event.projectId === "string" ? event.projectId : "";
      const rawWorktreeId = event.worktreeId;
      const worktreeId = typeof rawWorktreeId === "string" ? rawWorktreeId : null;
      const projectName =
        typeof event.projectName === "string" ? event.projectName : "Project";
      const taskTitle = typeof event.taskTitle === "string" ? event.taskTitle : "Session";
      const diagramTitle = typeof event.title === "string" ? event.title : null;
      if (!diagramId || !taskId || !projectId) return;

      const notification: DiagramReadyNotification = {
        kind: "diagram-ready",
        diagramId,
        taskId,
        projectId,
        worktreeId,
        projectName,
        taskTitle,
        diagramTitle,
        createdAt: Date.now(),
      };

      setNotifications((prev) => {
        const all = loadAppNotifications();
        const nextAll = mergeDiagramReadyNotification(all, notification);
        saveAppNotifications(nextAll);
        return nextAll.filter(
          (item): item is DiagramReadyNotification => item.kind === "diagram-ready",
        );
      });
    },
    [pruneNotifications],
  );

  useServerEvents(handler);

  const clearNotifications = useCallback(() => {
    const next = loadAppNotifications().filter((n) => n.kind !== "diagram-ready");
    saveAppNotifications(next);
    setNotifications([]);
  }, []);

  return { notifications, clearNotification, clearNotifications };
}

export function mergeAppNotificationLists(
  sessionNotifications: SessionFinishNotification[],
  diagramNotifications: DiagramReadyNotification[],
): AppNotification[] {
  return [...sessionNotifications, ...diagramNotifications].sort((a, b) => {
    const aTime = a.kind === "session-finished" ? a.finishedAt : a.createdAt;
    const bTime = b.kind === "session-finished" ? b.finishedAt : b.createdAt;
    return bTime - aTime;
  });
}

