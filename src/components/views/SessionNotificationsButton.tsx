import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import {
  requestDiagramNotificationOpen,
  requestSessionNotificationOpen,
  type AppNotification,
} from "~/lib/session-notification-store";

export function SessionNotificationsButton({
  notifications,
  onClearNotification,
  onClearNotifications,
}: {
  notifications: AppNotification[];
  onClearNotification: (notification: AppNotification) => void;
  onClearNotifications: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sorted = useMemo(
    () =>
      [...notifications].sort((a, b) => {
        const aTime = a.kind === "session-finished" ? a.finishedAt : a.createdAt;
        const bTime = b.kind === "session-finished" ? b.finishedAt : b.createdAt;
        return bTime - aTime;
      }),
    [notifications],
  );
  const visibleCount = Math.min(sorted.length, 9);
  const hasNotifications = sorted.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openNotification = (notification: AppNotification) => {
    if (notification.kind === "session-finished") {
      requestSessionNotificationOpen(notification);
    } else {
      requestDiagramNotificationOpen(notification);
    }
    setOpen(false);
    void router.navigate({
      to: "/projects/$id",
      params: { id: notification.projectId },
    });
  };

  const clearNotifications = () => {
    onClearNotifications();
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const clearNotification = (notification: AppNotification) => {
    onClearNotification(notification);
    if (sorted.length <= 1) {
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        className="mc-btn mc-btn-ghost mc-btn-md"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          hasNotifications
            ? `${sorted.length} notification${sorted.length === 1 ? "" : "s"}`
            : "Notifications"
        }
        title="Notifications"
        style={{ width: 42, padding: 0 }}
      >
        <span className="mc-btn-content">
          <Icon name="bell" size={13} />
        </span>
      </button>
      {hasNotifications && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            paddingInline: 4,
            borderRadius: 999,
            background: "var(--accent)",
            color: "#fff",
            boxShadow: "0 0 8px var(--accent-glow)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--mono)",
            fontSize: 9,
            fontWeight: 800,
            lineHeight: 1,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        >
          {visibleCount}
        </span>
      )}
      {open && (
        <CardFrame
          role="dialog"
          aria-label="Notifications"
          solid
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            boxShadow: "0 16px 36px rgba(0,0,0,0.46)",
            zIndex: 200,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "2px 2px 4px",
            }}
          >
            <div
              style={{
                color: "var(--text)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Notifications
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  color: "var(--text-faint)",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {sorted.length}
              </div>
              {hasNotifications && (
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  onClick={clearNotifications}
                  aria-label="Clear all notifications"
                  title="Clear all notifications"
                >
                  Clear all
                </Btn>
              )}
            </div>
          </div>
          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              paddingRight: 2,
            }}
          >
            {hasNotifications ? (
              sorted.map((notification) => (
                <NotificationRow
                  key={notificationKey(notification)}
                  notification={notification}
                  onOpen={() => openNotification(notification)}
                  onClear={() => clearNotification(notification)}
                />
              ))
            ) : (
              <div
                style={{
                  padding: "18px 8px",
                  color: "var(--text-dim)",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                Finished sessions and ready diagrams will appear here.
              </div>
            )}
          </div>
        </CardFrame>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onOpen,
  onClear,
}: {
  notification: AppNotification;
  onOpen: () => void;
  onClear: () => void;
}) {
  const isDiagram = notification.kind === "diagram-ready";
  const headline = isDiagram
    ? `Diagram ready — ${notification.projectName}`
    : `Session finished — ${notification.projectName}`;
  const subtitle = isDiagram
    ? notification.diagramTitle?.trim() || notification.taskTitle
    : notification.taskTitle;
  const timestamp = isDiagram ? notification.createdAt : notification.finishedAt;
  const openLabel = isDiagram
    ? `Open diagram ${subtitle}`
    : `Open ${subtitle}`;

  return (
    <div
      role="none"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto auto",
        gap: 8,
        alignItems: "center",
        padding: "10px 8px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: isDiagram
          ? "color-mix(in srgb, var(--accent) 6%, rgba(255,255,255,0.03))"
          : "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
        >
          {isDiagram && (
            <Icon
              name="chart"
              size={12}
              style={{
                color: "color-mix(in srgb, var(--accent) 76%, white)",
                flexShrink: 0,
              }}
            />
          )}
          <div
            style={{
              color: "color-mix(in srgb, var(--accent) 76%, white)",
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={headline}
          >
            {headline}
          </div>
        </div>
        <div
          style={{
            color: "var(--text-dim)",
            fontSize: 11,
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={subtitle}
        >
          {subtitle}
        </div>
        <div
          style={{
            color: "var(--text-faint)",
            fontFamily: "var(--mono)",
            fontSize: 10,
            marginTop: 5,
          }}
        >
          {formatTimestamp(timestamp)}
        </div>
      </div>
      <Btn
        type="button"
        variant="primary"
        size="sm"
        onClick={onOpen}
        aria-label={openLabel}
      >
        Open
      </Btn>
      <Btn
        type="button"
        variant="ghost"
        size="sm"
        icon="x"
        onClick={onClear}
        aria-label={`Clear ${subtitle}`}
        title={`Clear ${subtitle}`}
        style={{ width: 28, padding: 0 }}
      />
    </div>
  );
}

function notificationKey(notification: AppNotification) {
  if (notification.kind === "diagram-ready") {
    return `diagram:${notification.projectId}:${notification.diagramId}`;
  }
  return `session:${notification.projectId}:${notification.id}`;
}

function formatTimestamp(value: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "Just now";
  }
}
