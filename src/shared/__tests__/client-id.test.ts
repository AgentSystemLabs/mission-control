import { describe, expect, it } from "vitest";
import { isClientDomainId, newClientId } from "~/shared/client-id";

describe("client-id", () => {
  it("generates ids in the domain format", () => {
    const id = newClientId("t");
    expect(isClientDomainId(id)).toBe(true);
    expect(id.startsWith("t-")).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isClientDomainId("t-opt-123")).toBe(false);
    expect(isClientDomainId("")).toBe(false);
  });
});
