import type { BrowserWindow } from "electron";
import { Notification } from "electron";
import { errMsg } from "../src/shared/err-msg";

export type SessionFinishOsNotificationPayload = {
  tag: string;
  title: string;
  body: string;
  projectId: string;
  taskId: string;
  worktreeId: string | null;
};

export type NativeOsNotificationPermission = "granted" | "unsupported";

export function getNativeOsNotificationPermission(): NativeOsNotificationPermission {
  return Notification.isSupported() ? "granted" : "unsupported";
}

export function showSessionFinishOsNotification(
  window: BrowserWindow | null,
  payload: SessionFinishOsNotificationPayload,
  onClick: () => void,
): { ok: true } | { ok: false; error: string } {
  if (!Notification.isSupported()) {
    return { ok: false, error: "unsupported" };
  }

  try {
    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: false,
    });
    notification.on("click", () => {
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
      onClick();
      notification.close();
    });
    notification.show();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errMsg(error) };
  }
}
