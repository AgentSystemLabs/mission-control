import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => {
  class MockNotification {
    static isSupported = vi.fn(() => true);
    show = vi.fn();
    on = vi.fn();
    close = vi.fn();
    constructor(_options: unknown) {}
  }
  return { Notification: MockNotification };
});

import {
  getNativeOsNotificationPermission,
  showSessionFinishOsNotification,
} from "../session-finish-notification";
import { Notification } from "electron";

describe("getNativeOsNotificationPermission", () => {
  it("returns granted when native notifications are supported", () => {
    vi.mocked(Notification.isSupported).mockReturnValue(true);
    expect(getNativeOsNotificationPermission()).toBe("granted");
  });

  it("returns unsupported when native notifications are unavailable", () => {
    vi.mocked(Notification.isSupported).mockReturnValue(false);
    expect(getNativeOsNotificationPermission()).toBe("unsupported");
  });
});

describe("showSessionFinishOsNotification", () => {
  it("shows a native notification when supported", () => {
    vi.mocked(Notification.isSupported).mockReturnValue(true);
    const onClick = vi.fn();
    const result = showSessionFinishOsNotification(
      null,
      {
        tag: "session-finished-1",
        title: "Session finished — Demo",
        body: "Task title",
        projectId: "project-1",
        taskId: "task-1",
        worktreeId: null,
      },
      onClick,
    );

    expect(result).toEqual({ ok: true });
  });
});
