import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useSettings } from "~/queries";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";
import { CardFrame } from "~/components/ui/CardFrame";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";

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
        toast.custom(
          (t) => (
            <CardFrame
              style={{
                minWidth: 360,
                maxWidth: 460,
                padding: "14px 16px",
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
            </CardFrame>
          ),
          { duration: 6000 },
        );
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
