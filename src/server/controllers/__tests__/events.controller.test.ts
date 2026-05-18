import { describe, expect, it, vi } from "vitest";
import type { HostedAuthContext } from "../../hosted-auth-context";

const getHostedAuthContext = vi.hoisted(() => vi.fn());
const isHostedDatabaseEnabled = vi.hoisted(() => vi.fn());
const isElectronLocalApiRequest = vi.hoisted(() => vi.fn());

vi.mock("../../hosted-auth-context", () => ({
  getHostedAuthContext,
}));

vi.mock("../../hosted-pg", () => ({
  isHostedDatabaseEnabled,
}));

vi.mock("../../request-runtime", () => ({
  isElectronLocalApiRequest,
}));

const { issueTicket, stream } = await import("../events.controller");
const { events } = await import("../../events");

const context: HostedAuthContext = {
  sessionId: "hs-1",
  academyUserId: "academy-user-1",
  userId: "user-1",
  email: "user@example.com",
  organizationId: null,
};

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
  it("rejects hosted ticket issuance when no hosted session owns the request", async () => {
    isHostedDatabaseEnabled.mockReturnValue(true);
    isElectronLocalApiRequest.mockReturnValue(false);
    getHostedAuthContext.mockResolvedValue(null);

    const response = await issueTicket(
      new Request("http://127.0.0.1/api/events/ticket", {
        headers: { authorization: "Bearer local-token" },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("only emits scoped app events to the hosted user that owns them", async () => {
    isHostedDatabaseEnabled.mockReturnValue(true);
    isElectronLocalApiRequest.mockReturnValue(false);
    getHostedAuthContext.mockResolvedValue(context);

    const ticketResponse = await issueTicket(
      new Request("http://127.0.0.1/api/events/ticket"),
    );
    const { ticket } = (await ticketResponse.json()) as { ticket: string };
    const response = stream(new URL(`http://127.0.0.1/api/events?ticket=${ticket}`));
    const { reader } = await readNextEvent(response);

    events.emit("task:updated", {
      id: "other-task",
      projectId: "other-project",
      scope: { organizationId: null, userId: "user-2" },
    });
    events.emit("task:updated", {
      id: "owned-task",
      projectId: "owned-project",
      scope: { organizationId: null, userId: "user-1" },
    });

    const next = await reader.read();
    await reader.cancel();
    const text = new TextDecoder().decode(next.value);
    expect(text).toContain("owned-task");
    expect(text).not.toContain("other-task");
  });
});
