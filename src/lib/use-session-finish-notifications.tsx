import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { mcToastCustom, McToastCloseButton } from "~/lib/mc-toast";
import { useSettings } from "~/queries";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";
import { CardFrame } from "~/components/ui/CardFrame";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { playNotificationDing } from "~/lib/notification-sound";
import {
  showSessionFinishOsNotification,
  subscribeSessionFinishOsNotificationClick,
} from "~/lib/os-notifications";
import {
  SESSION_FINISH_NOTIFICATIONS_STORAGE_KEY,
  SESSION_NOTIFICATIONS_CHANGED_EVENT,
  loadAppNotifications,
  mergeSessionFinishNotification,
  pruneAppNotifications,
  publishAppNotifications,
  requestSessionNotificationOpen,
  type SessionFinishNotification,
  type SessionNotificationPruneTarget,
} from "~/lib/session-notification-store";

export function useSessionFinishNotifications() {
  const router = useRouter();
  const { data: settings } = useSettings();
  const toastEnabled = settings?.sessionFinishToastEnabled ?? true;
  const osEnabled = settings?.sessionFinishOsNotificationEnabled ?? false;
  const soundEnabled = settings?.notificationSoundEnabled ?? true;
  const [notifications, setNotifications] = useState<SessionFinishNotification[]>(() =>
    loadAppNotifications().filter(
      (notification): notification is SessionFinishNotification =>
        notification.kind === "session-finished",
    ),
  );

  const clearNotifications = useCallback(() => {
    const next = loadAppNotifications().filter((n) => n.kind !== "session-finished");
    publishAppNotifications(next);
    setNotifications([]);
  }, []);

  const clearNotification = useCallback((notification: SessionFinishNotification) => {
    setNotifications((prev) => {
      const next = prev.filter(
        (item) => !(item.id === notification.id && item.projectId === notification.projectId),
      );
      if (next.length === prev.length) return prev;
      publishAppNotifications(
        loadAppNotifications().filter(
          (item) =>
            !(
              item.kind === "session-finished" &&
              item.id === notification.id &&
              item.projectId === notification.projectId
            ),
        ),
      );
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reloadNotifications = () => {
      setNotifications(
        loadAppNotifications().filter(
          (notification): notification is SessionFinishNotification =>
            notification.kind === "session-finished",
        ),
      );
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_FINISH_NOTIFICATIONS_STORAGE_KEY) {
        reloadNotifications();
      }
    };
    window.addEventListener(SESSION_NOTIFICATIONS_CHANGED_EVENT, reloadNotifications);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(
        SESSION_NOTIFICATIONS_CHANGED_EVENT,
        reloadNotifications,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    return subscribeSessionFinishOsNotificationClick(({ projectId, taskId, worktreeId }) => {
      const stored = loadAppNotifications().find(
        (notification): notification is SessionFinishNotification =>
          notification.kind === "session-finished" &&
          notification.id === taskId &&
          notification.projectId === projectId,
      );
      if (stored) {
        requestSessionNotificationOpen(stored);
      } else {
        requestSessionNotificationOpen({
          kind: "session-finished",
          id: taskId,
          projectId,
          worktreeId,
          projectName: "Project",
          taskTitle: "Session",
          finishedAt: Date.now(),
        });
      }
      void router.navigate({ to: "/projects/$id", params: { id: projectId } });
    });
  }, [router]);

  const pruneNotifications = useCallback((target: SessionNotificationPruneTarget) => {
    setNotifications((prev) => {
      const all = loadAppNotifications();
      const nextAll = pruneAppNotifications(all, target);
      if (nextAll === all) return prev;
      publishAppNotifications(nextAll);
      return nextAll.filter(
        (notification): notification is SessionFinishNotification =>
          notification.kind === "session-finished",
      );
    });
  }, []);

  const handler = useCallback(
    (e: ServerEvent) => {
      if (e.type === "task:deleted") {
        const taskId = String(e.id ?? "");
        const projectId = typeof e.projectId === "string" ? e.projectId : undefined;
        if (taskId) pruneNotifications({ type: "task", taskId, projectId });
        return;
      }

      if (e.type === "project:deleted") {
        const projectId = String(e.id ?? "");
        if (projectId) pruneNotifications({ type: "project", projectId });
        return;
      }

      if (e.type === "worktree:deleted") {
        const worktreeId = String(e.id ?? "");
        const projectId = String(e.projectId ?? "");
        if (worktreeId && projectId) {
          pruneNotifications({ type: "worktree", projectId, worktreeId });
        }
        return;
      }

      if (e.type !== "session:finished") return;
      const id = String(e.id ?? "");
      const projectId = String(e.projectId ?? "");
      const rawWorktreeId = e.worktreeId;
      const worktreeId = typeof rawWorktreeId === "string" ? rawWorktreeId : null;
      const projectName = String(e.projectName ?? "Project");
      const taskTitle = String(e.taskTitle ?? "Session");
      if (!id || !projectId) return;

      const notification: SessionFinishNotification = {
        kind: "session-finished",
        id,
        projectId,
        worktreeId,
        projectName,
        taskTitle,
        finishedAt: Date.now(),
      };

      setNotifications((prev) => {
        const all = loadAppNotifications();
        const nextAll = mergeSessionFinishNotification(all, notification);
        publishAppNotifications(nextAll);
        return nextAll.filter(
          (item): item is SessionFinishNotification => item.kind === "session-finished",
        );
      });

      playNotificationDing(soundEnabled);

      const goToProject = () => {
        requestSessionNotificationOpen(notification);
        void router.navigate({ to: "/projects/$id", params: { id: projectId } });
      };

      if (toastEnabled) {
        mcToastCustom(
          (t) => (
            <CardFrame
              style={{
                position: "relative",
                minWidth: 360,
                maxWidth: 460,
                padding: "14px 96px 14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: "color-mix(in srgb, var(--accent) 22%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent)",
                  flexShrink: 0,
                }}
              >
                <Icon name="check" size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "color-mix(in srgb, var(--accent) 76%, white)",
                    fontWeight: 700,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Session finished — {projectName}
                </div>
                <div
                  style={{
                    color: "var(--text-faint, rgba(255,255,255,0.6))",
                    fontSize: 12,
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {taskTitle}
                </div>
              </div>
              <Btn
                variant="primary"
                size="sm"
                onClick={() => {
                  goToProject();
                  toast.dismiss(t);
                }}
              >
                Open
              </Btn>
              <McToastCloseButton toastId={t} />
            </CardFrame>
          ),
          { duration: 6000 },
        );
      }

      if (osEnabled) {
        void showSessionFinishOsNotification(
          {
            tag: `session-finished-${e.id}`,
            title: `Session finished — ${projectName}`,
            body: taskTitle,
            projectId,
            taskId: id,
            worktreeId,
          },
          { onClick: goToProject },
        );
      }
    },
    [toastEnabled, osEnabled, soundEnabled, router, pruneNotifications],
  );

  useServerEvents(handler);
  return { notifications, clearNotification, clearNotifications };
}
