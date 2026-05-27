import { getElectron } from "~/lib/electron";

export type OsNotificationPermission = NotificationPermission | "unsupported";

export type SessionFinishOsNotificationPayload = {
  tag: string;
  title: string;
  body: string;
  projectId: string;
  taskId: string;
  worktreeId: string | null;
};

export async function readOsNotificationPermission(): Promise<OsNotificationPermission> {
  const electron = getElectron();
  if (electron?.notifications) {
    return electron.notifications.getPermission();
  }
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestOsNotificationPermission(): Promise<OsNotificationPermission> {
  const electron = getElectron();
  if (electron?.notifications) {
    return electron.notifications.getPermission();
  }
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.requestPermission();
}

export async function showSessionFinishOsNotification(
  payload: SessionFinishOsNotificationPayload,
  opts?: { onClick?: () => void },
): Promise<boolean> {
  const electron = getElectron();
  if (electron?.notifications) {
    const result = await electron.notifications.showSessionFinished(payload);
    return result.ok;
  }
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  try {
    const notification = new Notification(payload.title, {
      body: payload.body,
      tag: payload.tag,
    });
    notification.onclick = () => {
      window.focus();
      opts?.onClick?.();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function subscribeSessionFinishOsNotificationClick(
  onOpen: (payload: Omit<SessionFinishOsNotificationPayload, "tag" | "title" | "body">) => void,
): () => void {
  const electron = getElectron();
  if (!electron?.notifications) return () => {};
  return electron.notifications.onSessionFinishedClick(onOpen);
}
