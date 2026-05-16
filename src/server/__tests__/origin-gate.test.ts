import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-origin-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { isSameOriginRequest } = await import("../auth");
const { getDb } = await import("~/db/client");
const { appSettings } = await import("~/db/schema");

describe("local-origin gate", () => {
  beforeEach(() => {
    getDb().delete(appSettings).run();
  });

  describe("isSameOriginRequest", () => {
    it("accepts requests with a loopback Origin", () => {
      const req = new Request("http://127.0.0.1:5173/api/projects", {
        headers: { origin: "http://127.0.0.1:5173" },
      });
      expect(isSameOriginRequest(req)).toBe(true);
    });

    it("accepts localhost as a loopback origin", () => {
      const req = new Request("http://localhost/api/projects", {
        headers: { origin: "http://localhost:54321" },
      });
      expect(isSameOriginRequest(req)).toBe(true);
    });

    it("rejects a cross-origin Origin header", () => {
      const req = new Request("http://127.0.0.1:5173/api/projects", {
        headers: { origin: "https://evil.com" },
      });
      expect(isSameOriginRequest(req)).toBe(false);
    });

    it("rejects an opaque (null) Origin from sandboxed iframes", () => {
      const req = new Request("http://127.0.0.1:5173/api/projects", {
        headers: { origin: "null", host: "127.0.0.1:5173" },
      });
      expect(isSameOriginRequest(req)).toBe(false);
    });

    it("rejects a non-loopback Host header (DNS rebinding)", () => {
      const req = new Request("http://evil.com/api/projects", {
        headers: { host: "evil.com:5173" },
      });
      expect(isSameOriginRequest(req)).toBe(false);
    });

    it("falls back to Host when Origin is absent (curl / hook callers)", () => {
      const req = new Request("http://evil.com/api/hooks/claude", {
        headers: { host: "127.0.0.1:54321" },
      });
      expect(isSameOriginRequest(req)).toBe(true);
    });

    it("falls back to request.url when neither Origin nor Host is set", () => {
      const req = new Request("http://localhost/api/settings");
      expect(isSameOriginRequest(req)).toBe(true);
    });

    it("handles bracketed IPv6 loopback in Host", () => {
      const req = new Request("http://[::1]/api/projects", {
        headers: { host: "[::1]:54321" },
      });
      expect(isSameOriginRequest(req)).toBe(true);
    });
  });

  describe("handleApiRequest router gate", () => {
    it("returns 403 for a cross-origin browser fetch", async () => {
      const response = await handleApiRequest(
        new Request("http://127.0.0.1:5173/api/settings", {
          headers: { origin: "https://evil.com" },
        }),
      );
      expect(response?.status).toBe(403);
    });

    it("returns 403 for DNS-rebinding-style requests with a foreign Host", async () => {
      const response = await handleApiRequest(
        new Request("http://evil.com/api/projects", {
          method: "DELETE",
          headers: { host: "evil.com:54321" },
        }),
      );
      expect(response?.status).toBe(403);
    });

    it("allows real renderer requests from the loopback origin", async () => {
      const response = await handleApiRequest(
        new Request("http://127.0.0.1:5173/api/settings", {
          headers: { origin: "http://127.0.0.1:5173" },
        }),
      );
      expect(response?.status).toBe(200);
    });
  });
});
