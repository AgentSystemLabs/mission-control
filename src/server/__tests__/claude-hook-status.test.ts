import { describe, expect, it } from "vitest";
import { mapHookEventToStatus } from "../api-router";

describe("agent hook status mapping", () => {
  it("maps turn lifecycle events", () => {
    expect(mapHookEventToStatus({ hook_event_name: "UserPromptSubmit" })).toBe("running");
    expect(mapHookEventToStatus({ hook_event_name: "Stop" })).toBe("finished");
    expect(mapHookEventToStatus({ hook_event_name: "UserInterrupt" })).toBe("interrupted");
  });

  it("maps Cursor hook lifecycle events", () => {
    expect(mapHookEventToStatus({ hook_event_name: "beforeSubmitPrompt" })).toBe("running");
    expect(mapHookEventToStatus({ hook_event_name: "stop" })).toBe("finished");
    expect(mapHookEventToStatus({ hook_event_name: "afterAgentResponse" })).toBe("finished");
  });

  it("maps permission requests to needs-input", () => {
    expect(mapHookEventToStatus({ hook_event_name: "PermissionRequest" })).toBe(
      "needs-input"
    );
  });

  it("does not treat subagent completion as task completion", () => {
    expect(mapHookEventToStatus({ hook_event_name: "SubagentStop" })).toBeNull();
  });

  it("only maps permission notifications to needs-input", () => {
    expect(
      mapHookEventToStatus({
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
      })
    ).toBe("needs-input");
    expect(
      mapHookEventToStatus({
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
      })
    ).toBeNull();
  });
});
