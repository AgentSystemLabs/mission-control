import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useSettings } from "~/queries";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";

export function useSessionFinishNotifications() {
  const router = useRouter();
  const { data: settings } = useSettings();
  const toastEnabled = settings?.sessionFinishToastEnabled ?? true;
  const osEnabled = settings?.sessionFinishOsNotificationEnabled ?? false;

  const handler = useCallback(
    (e: ServerEvent) => {
      if (e.type !== "session:finished") return;
      const projectId = String(e.projectId ?? "");
      const projectName = String(e.projectName ?? "Project");
      const taskTitle = String(e.taskTitle ?? "Session");
      if (!projectId) return;

      const goToProject = () => {
        void router.navigate({ to: "/projects/$id", params: { id: projectId } });
      };

      if (toastEnabled) {
        toast.success(`Session finished — ${projectName}`, {
          description: taskTitle,
          action: {
            label: "Open",
            onClick: goToProject,
          },
        });
      }

      if (
        osEnabled &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        try {
          const n = new Notification(`Session finished — ${projectName}`, {
            body: taskTitle,
            tag: `session-finished-${e.id}`,
          });
          n.onclick = () => {
            window.focus();
            goToProject();
            n.close();
          };
        } catch {
          /* ignore */
        }
      }
    },
    [toastEnabled, osEnabled, router],
  );

  useServerEvents(handler);
}
