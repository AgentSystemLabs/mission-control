export type SessionFinishNotification = {
  id: string;
  projectId: string;
  worktreeId: string | null;
  projectName: string;
  taskTitle: string;
  finishedAt: number;
};

export type SessionNotificationPruneTarget =
  | { type: "task"; taskId: string; projectId?: string }
  | { type: "project"; projectId: string }
  | { type: "worktree"; projectId: string; worktreeId: string | null };

export type PendingSessionOpen = {
  projectId: string;
  worktreeId: string | null;
  taskId: string;
  requestedAt: number;
};

export const SESSION_NOTIFICATION_OPEN_EVENT = "mc:session-notification-open";
export const SESSION_NOTIFICATIONS_CHANGED_EVENT =
  "mc:session-notifications-changed";

const NOTIFICATIONS_KEY = "mc:sessionFinishNotifications";
const PENDING_OPEN_KEY = "mc:pendingSessionOpen";
const PENDING_OPEN_MAX_AGE_MS = 5 * 60_000;

export const SESSION_FINISH_NOTIFICATIONS_STORAGE_KEY = NOTIFICATIONS_KEY;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNotification(value: unknown): SessionFinishNotification | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const projectId = typeof value.projectId === "string" ? value.projectId : "";
  if (!("worktreeId" in value)) return null;
  const worktreeId = typeof value.worktreeId === "string" ? value.worktreeId : null;
  const projectName = typeof value.projectName === "string" ? value.projectName : "Project";
  const taskTitle = typeof value.taskTitle === "string" ? value.taskTitle : "Session";
  const finishedAt = typeof value.finishedAt === "number" ? value.finishedAt : 0;
  if (!id || !projectId || !Number.isFinite(finishedAt)) return null;
  return { id, projectId, worktreeId, projectName, taskTitle, finishedAt };
}

function toPendingOpen(value: unknown): PendingSessionOpen | null {
  if (!isRecord(value)) return null;
  const projectId = typeof value.projectId === "string" ? value.projectId : "";
  if (!("worktreeId" in value)) return null;
  const worktreeId = typeof value.worktreeId === "string" ? value.worktreeId : null;
  const taskId = typeof value.taskId === "string" ? value.taskId : "";
  const requestedAt = typeof value.requestedAt === "number" ? value.requestedAt : 0;
  if (!projectId || !taskId || !Number.isFinite(requestedAt)) return null;
  return { projectId, worktreeId, taskId, requestedAt };
}

export function loadSessionFinishNotifications(): SessionFinishNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NOTIFICATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toNotification)
      .filter((n): n is SessionFinishNotification => !!n)
      .sort((a, b) => b.finishedAt - a.finishedAt);
  } catch {
    return [];
  }
}

export function saveSessionFinishNotifications(
  notifications: SessionFinishNotification[],
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  } catch {
    /* quota or privacy-mode storage */
  }
}

export function clearSessionFinishNotifications() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(NOTIFICATIONS_KEY);
    dispatchSessionNotificationsChanged([]);
  } catch {
    /* quota or privacy-mode storage */
  }
}

export function mergeSessionFinishNotification(
  current: SessionFinishNotification[],
  next: SessionFinishNotification,
): SessionFinishNotification[] {
  return [
    next,
    ...current.filter(
      (n) => !(n.id === next.id && n.projectId === next.projectId),
    ),
  ].sort((a, b) => b.finishedAt - a.finishedAt);
}

function notificationMatchesPruneTarget(
  notification: SessionFinishNotification,
  target: SessionNotificationPruneTarget,
): boolean {
  if (target.type === "task") {
    return (
      notification.id === target.taskId &&
      (!target.projectId || notification.projectId === target.projectId)
    );
  }
  if (target.type === "project") {
    return notification.projectId === target.projectId;
  }
  return (
    notification.projectId === target.projectId &&
    notification.worktreeId === target.worktreeId
  );
}

export function pruneSessionFinishNotifications(
  current: SessionFinishNotification[],
  target: SessionNotificationPruneTarget,
): SessionFinishNotification[] {
  const next = current.filter(
    (notification) => !notificationMatchesPruneTarget(notification, target),
  );
  return next.length === current.length ? current : next;
}

function notificationPruneTarget(
  notification: SessionFinishNotification,
): SessionNotificationPruneTarget {
  return {
    type: "task",
    taskId: notification.id,
    projectId: notification.projectId,
  };
}

export function pruneSessionFinishNotification(
  current: SessionFinishNotification[],
  notification: SessionFinishNotification,
): SessionFinishNotification[] {
  return pruneSessionFinishNotifications(
    current,
    notificationPruneTarget(notification),
  );
}

function dispatchSessionNotificationsChanged(
  notifications: SessionFinishNotification[],
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SESSION_NOTIFICATIONS_CHANGED_EVENT, {
      detail: { notifications },
    }),
  );
}

export function pruneStoredSessionFinishNotifications(
  target: SessionNotificationPruneTarget,
): SessionFinishNotification[] {
  const current = loadSessionFinishNotifications();
  const next = pruneSessionFinishNotifications(current, target);
  if (next !== current) {
    saveSessionFinishNotifications(next);
    dispatchSessionNotificationsChanged(next);
  }
  return next;
}

export function pruneStoredSessionFinishNotification(
  notification: SessionFinishNotification,
): SessionFinishNotification[] {
  return pruneStoredSessionFinishNotifications(
    notificationPruneTarget(notification),
  );
}

export function requestSessionNotificationOpen(
  notification: SessionFinishNotification,
) {
  if (typeof window === "undefined") return;
  const request: PendingSessionOpen = {
    projectId: notification.projectId,
    worktreeId: notification.worktreeId,
    taskId: notification.id,
    requestedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(PENDING_OPEN_KEY, JSON.stringify(request));
  } catch {
    /* quota or privacy-mode storage */
  }
  window.dispatchEvent(
    new CustomEvent<PendingSessionOpen>(SESSION_NOTIFICATION_OPEN_EVENT, {
      detail: request,
    }),
  );
  pruneStoredSessionFinishNotification(notification);
}

export function readPendingSessionOpen(
  projectId: string,
): PendingSessionOpen | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_OPEN_KEY);
    if (!raw) return null;
    const request = toPendingOpen(JSON.parse(raw));
    if (!request) return null;
    if (Date.now() - request.requestedAt > PENDING_OPEN_MAX_AGE_MS) {
      window.localStorage.removeItem(PENDING_OPEN_KEY);
      return null;
    }
    return request.projectId === projectId ? request : null;
  } catch {
    return null;
  }
}

export function clearPendingSessionOpen(request: PendingSessionOpen) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(PENDING_OPEN_KEY);
    const current = raw ? toPendingOpen(JSON.parse(raw)) : null;
    if (
      current &&
      current.projectId === request.projectId &&
      current.taskId === request.taskId &&
      current.requestedAt === request.requestedAt
    ) {
      window.localStorage.removeItem(PENDING_OPEN_KEY);
    }
  } catch {
    /* ignore malformed storage */
  }
}
