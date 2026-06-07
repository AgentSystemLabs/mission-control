import { useSyncExternalStore } from "react";
import { LOCAL_SCOPE_ID, normalizeScopeId } from "~/shared/sandbox";
import type { ServerEvent } from "~/lib/use-events";
import {
  getDiagramReadyNotificationsSnapshot,
  loadAppNotifications,
  mergeDiagramReadyNotification,
  publishAppNotifications,
  subscribeAppNotifications,
  type DiagramReadyNotification,
  type SessionFinishNotification,
} from "~/lib/session-notification-store";

export function useDiagramReadyNotificationList(): DiagramReadyNotification[] {
  return useSyncExternalStore(
    subscribeAppNotifications,
    getDiagramReadyNotificationsSnapshot,
    () => [],
  );
}

export function persistDiagramReadyServerEvent(event: ServerEvent): boolean {
  if (event.type !== "diagram:show") return false;

  const diagramId = typeof event.id === "string" ? event.id : "";
  const taskId = typeof event.taskId === "string" ? event.taskId : "";
  const projectId = typeof event.projectId === "string" ? event.projectId : "";
  const rawWorktreeId = event.worktreeId;
  const worktreeId = typeof rawWorktreeId === "string" ? rawWorktreeId : null;
  const projectName =
    typeof event.projectName === "string" ? event.projectName : "Project";
  const taskTitle = typeof event.taskTitle === "string" ? event.taskTitle : "Session";
  const diagramTitle = typeof event.title === "string" ? event.title : null;
  const rawScopeId = event.scopeId;
  const scopeId = normalizeScopeId(
    typeof rawScopeId === "string" ? rawScopeId : LOCAL_SCOPE_ID,
  );
  if (!diagramId || !taskId || !projectId) return false;

  const notification: DiagramReadyNotification = {
    kind: "diagram-ready",
    diagramId,
    taskId,
    projectId,
    worktreeId,
    scopeId,
    projectName,
    taskTitle,
    diagramTitle,
    createdAt: Date.now(),
  };

  const nextAll = mergeDiagramReadyNotification(loadAppNotifications(), notification);
  publishAppNotifications(nextAll);
  return true;
}

export function mergeAppNotificationLists(
  sessionNotifications: SessionFinishNotification[],
  diagramNotifications: DiagramReadyNotification[],
) {
  return [...sessionNotifications, ...diagramNotifications].sort((a, b) => {
    const aTime = a.kind === "session-finished" ? a.finishedAt : a.createdAt;
    const bTime = b.kind === "session-finished" ? b.finishedAt : b.createdAt;
    return bTime - aTime;
  });
}
