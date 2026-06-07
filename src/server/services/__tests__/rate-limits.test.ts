import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimitsForTests } from "../rate-limits";

describe("rate limits", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
  });

  it("returns 429 after a fixed-window limit is exhausted", () => {
    expect(rateLimit("test:bucket", { limit: 1, windowMs: 60_000 }).ok).toBe(true);
    const limited = rateLimit("test:bucket", { limit: 1, windowMs: 60_000 });

    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.response.status).toBe(429);
      expect(limited.response.headers.get("retry-after")).toBe("60");
    }
  });
});
