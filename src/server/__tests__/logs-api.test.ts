import { beforeEach, describe, expect, it } from "vitest";

const { handleApiRequest } = await import("../api-router");
const { appLogger, clearLogs, listLogs } = await import("../services/logger");

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("logs API", () => {
  beforeEach(() => {
    clearLogs();
  });

  it("returns in-memory logs without logging the logs endpoint", async () => {
    appLogger.info("system", "Ready");

    const response = await handleApiRequest(new Request("http://localhost/api/logs"));
    const body = await jsonBody(response!);

    expect(response?.status).toBe(200);
    expect((body.logs as unknown[])).toHaveLength(1);
    expect(listLogs()).toHaveLength(1);
  });

  it("records API errors with status metadata", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/api/not-found"),
    );
    const [log] = listLogs();

    expect(response?.status).toBe(404);
    expect(log).toMatchObject({
      level: "warn",
      category: "api",
      message: "GET /api/not-found failed",
      metadata: {
        method: "GET",
        path: "/api/not-found",
        status: 404,
      },
    });
  });
});
