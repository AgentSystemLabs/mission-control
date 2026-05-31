import { describe, it, expect } from "vitest";
import {
  classifyConnectError,
  connectTimeoutMessage,
  isFailFastConnectError,
} from "../sandbox-connect-errors";

describe("classifyConnectError", () => {
  it("treats auth failures as fail-fast", () => {
    const r = classifyConnectError(new Error("Unexpected server response: 401"));
    expect(r.kind).toBe("auth");
    expect(isFailFastConnectError(r.kind)).toBe(true);
  });

  it("treats DNS failures as fail-fast", () => {
    const r = classifyConnectError(new Error("getaddrinfo ENOTFOUND agent.example.com"));
    expect(r.kind).toBe("host");
    expect(isFailFastConnectError(r.kind)).toBe(true);
  });

  it("treats socket hang up as transient", () => {
    const r = classifyConnectError(new Error("socket hang up"));
    expect(r.kind).toBe("transient");
    expect(isFailFastConnectError(r.kind)).toBe(false);
  });
});

describe("connectTimeoutMessage", () => {
  it("includes the budget in seconds for remote sandboxes", () => {
    expect(connectTimeoutMessage("remote-vm", 90_000)).toContain("90s");
    expect(connectTimeoutMessage("remote-vm", 90_000)).toMatch(/agent URL and API key/i);
  });
});
