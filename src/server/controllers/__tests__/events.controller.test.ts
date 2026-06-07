import { describe, expect, it } from "vitest";
import { issueTicket, stream } from "../events.controller";
import { events } from "../../events";

async function readNextEvent(response: Response): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  text: string;
}> {
  const reader = response.body!.getReader();
  const chunk = await reader.read();
  return {
    reader,
    text: new TextDecoder().decode(chunk.value),
  };
}

describe("events controller", () => {
  it("rejects stream requests without a valid ticket", () => {
    const response = stream(new URL("http://127.0.0.1/api/events?ticket=nope"));
    expect(response.status).toBe(401);
  });

  it("issues a single-use ticket that opens the SSE stream once", async () => {
    const ticketResponse = issueTicket();
    expect(ticketResponse.status).toBe(200);
    const { ticket } = (await ticketResponse.json()) as { ticket: string };
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);

    const opened = stream(new URL(`http://127.0.0.1/api/events?ticket=${ticket}`));
    expect(opened.status).toBe(200);
    await opened.body?.cancel();

    const reused = stream(new URL(`http://127.0.0.1/api/events?ticket=${ticket}`));
    expect(reused.status).toBe(401);
  });

  it("delivers emitted app events to a subscribed stream", async () => {
    const { ticket } = (await issueTicket().json()) as { ticket: string };
    const response = stream(new URL(`http://127.0.0.1/api/events?ticket=${ticket}`));
    const { reader } = await readNextEvent(response);

    events.emit("task:updated", { id: "task-1", projectId: "project-1" });

    const next = await reader.read();
    await reader.cancel();
    const text = new TextDecoder().decode(next.value);
    expect(text).toContain("task-1");
  });

  it("delivers diagram:show events to a subscribed stream", async () => {
    const { ticket } = (await issueTicket().json()) as { ticket: string };
    const response = stream(new URL(`http://127.0.0.1/api/events?ticket=${ticket}`));
    const { reader } = await readNextEvent(response);

    events.emit("diagram:show", {
      id: "diagram-1",
      taskId: "task-1",
      projectId: "project-1",
      title: "Flow",
      source: "flowchart LR\n  A --> B",
      format: "mermaid",
      projectName: "Project",
      taskTitle: "Task",
      worktreeId: null,
      scopeId: "local",
    });

    const next = await reader.read();
    await reader.cancel();
    const text = new TextDecoder().decode(next.value);
    expect(text).toContain("diagram-1");
  });
});
