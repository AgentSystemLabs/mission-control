import { describe, expect, it } from "vitest";
import {
  clearSessionFinishNotifications,
  loadAppNotifications,
  loadSessionFinishNotifications,
  pruneSessionFinishNotifications,
  requestDiagramNotificationOpen,
  requestSessionNotificationOpen,
  saveAppNotifications,
  saveSessionFinishNotifications,
  type DiagramReadyNotification,
  type SessionFinishNotification,
} from "../session-notification-store";

const notifications: SessionFinishNotification[] = [
  {
    kind: "session-finished",
    id: "task-1",
    projectId: "project-1",
    worktreeId: null,
    scopeId: "local",
    projectName: "Core",
    taskTitle: "Answer name question",
    finishedAt: 3,
  },
  {
    kind: "session-finished",
    id: "task-2",
    projectId: "project-1",
    worktreeId: "worktree-1",
    scopeId: "sb-1",
    projectName: "Core",
    taskTitle: "Investigate router error",
    finishedAt: 2,
  },
  {
    kind: "session-finished",
    id: "task-1",
    projectId: "project-2",
    worktreeId: null,
    scopeId: "local",
    projectName: "Academy",
    taskTitle: "Generate title",
    finishedAt: 1,
  },
];

describe("pruneSessionFinishNotifications", () => {
  it("removes the notification for a deleted task in the matching project", () => {
    const next = pruneSessionFinishNotifications(notifications, {
      type: "task",
      taskId: "task-1",
      projectId: "project-1",
    });

    expect(next.map((n) => `${n.projectId}:${n.kind === "session-finished" ? n.id : n.taskId}`)).toEqual([
      "project-1:task-2",
      "project-2:task-1",
    ]);
  });

  it("removes task notifications by id when the project is unknown", () => {
    const next = pruneSessionFinishNotifications(notifications, {
      type: "task",
      taskId: "task-1",
    });

    expect(next.map((n) => `${n.projectId}:${n.kind === "session-finished" ? n.id : n.taskId}`)).toEqual([
      "project-1:task-2",
    ]);
  });

  it("removes every notification for a deleted project", () => {
    const next = pruneSessionFinishNotifications(notifications, {
      type: "project",
      projectId: "project-1",
    });

    expect(next.map((n) => `${n.projectId}:${n.kind === "session-finished" ? n.id : n.taskId}`)).toEqual([
      "project-2:task-1",
    ]);
  });

  it("removes notifications scoped to a deleted worktree", () => {
    const next = pruneSessionFinishNotifications(notifications, {
      type: "worktree",
      projectId: "project-1",
      worktreeId: "worktree-1",
    });

    expect(next.map((n) => `${n.projectId}:${n.kind === "session-finished" ? n.id : n.taskId}`)).toEqual([
      "project-1:task-1",
      "project-2:task-1",
    ]);
  });

  it("keeps the same array when nothing matches", () => {
    const next = pruneSessionFinishNotifications(notifications, {
      type: "task",
      taskId: "missing",
    });

    expect(next).toBe(notifications);
  });
});

describe("clearSessionFinishNotifications", () => {
  it("clears persisted notifications and emits the notification change event", () => {
    const store = new Map<string, string>();
    const dispatchedEvents: Event[] = [];
    const notification = notifications[0]!;
    const previousWindow = globalThis.window;

    globalThis.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      dispatchEvent: (event: Event) => {
        dispatchedEvents.push(event);
        return true;
      },
    } as unknown as Window & typeof globalThis;

    try {
      saveSessionFinishNotifications([notification]);
      expect(loadSessionFinishNotifications()).toEqual([notification]);

      clearSessionFinishNotifications();

      expect(loadSessionFinishNotifications()).toEqual([]);
      expect(dispatchedEvents).toHaveLength(1);
      expect(dispatchedEvents[0]?.type).toBe("mc:session-notifications-changed");
    } finally {
      globalThis.window = previousWindow;
    }
  });
});

describe("requestDiagramNotificationOpen", () => {
  it("clears the opened diagram notification and emits diagram open plus change events", () => {
    const store = new Map<string, string>();
    const dispatchedEvents: Event[] = [];
    const notification: DiagramReadyNotification = {
      kind: "diagram-ready",
      diagramId: "diagram-1",
      taskId: "task-1",
      projectId: "project-1",
      worktreeId: null,
      scopeId: "sb-1",
      projectName: "Core",
      taskTitle: "Build flow",
      diagramTitle: "Pipeline",
      createdAt: 1,
    };
    const previousWindow = globalThis.window;

    globalThis.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      dispatchEvent: (event: Event) => {
        dispatchedEvents.push(event);
        return true;
      },
    } as unknown as Window & typeof globalThis;

    try {
      saveAppNotifications([
        notifications[0]!,
        notification,
      ]);

      requestDiagramNotificationOpen(notification);

      expect(loadAppNotifications().map((n) =>
        n.kind === "diagram-ready"
          ? `diagram:${n.projectId}:${n.diagramId}`
          : `session:${n.projectId}:${n.id}`,
      )).toEqual(["session:project-1:task-1"]);
      expect(dispatchedEvents.map((event) => event.type)).toEqual([
        "mc:diagram-notification-open",
        "mc:session-notifications-changed",
      ]);
      expect((dispatchedEvents[0] as CustomEvent).detail).toMatchObject({
        kind: "diagram-ready",
        projectId: "project-1",
        taskId: "task-1",
        diagramId: "diagram-1",
        scopeId: "sb-1",
      });
    } finally {
      globalThis.window = previousWindow;
    }
  });
});

describe("requestSessionNotificationOpen", () => {
  it("clears the opened notification and emits open plus change events", () => {
    const store = new Map<string, string>();
    const dispatchedEvents: Event[] = [];
    const notification = notifications[0]!;
    const previousWindow = globalThis.window;

    globalThis.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      dispatchEvent: (event: Event) => {
        dispatchedEvents.push(event);
        return true;
      },
    } as unknown as Window & typeof globalThis;

    try {
      saveSessionFinishNotifications(notifications);

      requestSessionNotificationOpen(notification);

      expect(loadSessionFinishNotifications().map((n) => `${n.projectId}:${n.id}`))
        .toEqual(["project-1:task-2", "project-2:task-1"]);
      expect(dispatchedEvents.map((event) => event.type)).toEqual([
        "mc:session-notification-open",
        "mc:session-notifications-changed",
      ]);
      expect((dispatchedEvents[0] as CustomEvent).detail).toMatchObject({
        kind: "session-finished",
        projectId: "project-1",
        taskId: "task-1",
        scopeId: "local",
      });
    } finally {
      globalThis.window = previousWindow;
    }
  });
});

describe("scopeId persistence", () => {
  it("defaults missing scopeId to local when loading legacy notifications", () => {
    const store = new Map<string, string>();
    const previousWindow = globalThis.window;

    globalThis.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      dispatchEvent: () => true,
    } as unknown as Window & typeof globalThis;

    try {
      store.set(
        "mc:sessionFinishNotifications",
        JSON.stringify([
          {
            kind: "session-finished",
            id: "task-legacy",
            projectId: "project-1",
            worktreeId: null,
            projectName: "Core",
            taskTitle: "Legacy session",
            finishedAt: 1,
          },
        ]),
      );

      expect(loadSessionFinishNotifications()[0]?.scopeId).toBe("local");
    } finally {
      globalThis.window = previousWindow;
    }
  });
});
