import { describe, expect, it, vi } from "vitest";
import { missionControlApi } from "../vite-api-plugin";

describe("missionControlApi", () => {
  it("masks middleware exceptions before responding", async () => {
    let handler:
      | ((req: unknown, res: unknown, next: () => void) => void | Promise<void>)
      | undefined;
    const plugin = missionControlApi();
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== "function") {
      throw new Error("expected configureServer hook");
    }
    (configureServer as (this: unknown, server: unknown) => void).call({}, {
      middlewares: {
        use(fn: typeof handler) {
          handler = fn;
        },
      },
      ssrLoadModule: vi.fn(async () => {
        throw new Error("secret vite stack trace");
      }),
    });

    const headers = new Map<string, string>();
    let body = "";
    const res = {
      statusCode: 0,
      writableEnded: false,
      setHeader(key: string, value: string) {
        headers.set(key.toLowerCase(), value);
      },
      end(chunk?: string) {
        if (chunk) body += chunk;
        this.writableEnded = true;
      },
    };

    if (!handler) throw new Error("middleware handler was not registered");
    await handler(
      { url: "/api/projects", method: "GET", headers: {} },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(500);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(body)).toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
    expect(body).not.toContain("secret vite");
  });
});
