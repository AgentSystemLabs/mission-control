import { describe, it, expect } from "vitest";
import { parseClientMessage } from "../protocol";

describe("parseClientMessage", () => {
  it("rejects non-JSON and non-objects", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage("42")).toBeNull();
    expect(parseClientMessage("null")).toBeNull();
  });

  it("rejects unknown message types", () => {
    expect(parseClientMessage(JSON.stringify({ type: "bogus" }))).toBeNull();
  });

  it("accepts a well-formed spawn", () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: "spawn", ptyId: "p1", taskId: "t1", cwd: "/workspace/x", command: "claude" }),
    );
    expect(msg?.type).toBe("spawn");
  });

  it("rejects a spawn missing required fields", () => {
    expect(parseClientMessage(JSON.stringify({ type: "spawn", ptyId: "p1" }))).toBeNull();
  });

  it("validates write/resize/kill/replay shape", () => {
    expect(parseClientMessage(JSON.stringify({ type: "write", ptyId: "p", data: "x" }))?.type).toBe("write");
    expect(parseClientMessage(JSON.stringify({ type: "write", ptyId: "p" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: "resize", ptyId: "p", cols: 80, rows: 24 }))?.type,
    ).toBe("resize");
    expect(parseClientMessage(JSON.stringify({ type: "resize", ptyId: "p", cols: "80" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "kill", ptyId: "p" }))?.type).toBe("kill");
    expect(parseClientMessage(JSON.stringify({ type: "replay", ptyId: "p" }))?.type).toBe("replay");
  });

  it("accepts known rpc methods and rejects unknown ones", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: "rpc", reqId: "r1", method: "git.status", params: { repo: "/workspace/x" } }),
      )?.type,
    ).toBe("rpc");
    expect(
      parseClientMessage(JSON.stringify({ type: "rpc", reqId: "r1", method: "evil.exec", params: {} })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: "rpc", reqId: "r1", method: "fs.read" })),
    ).toBeNull(); // missing params
  });

  it("accepts the creds.setup rpc method", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "rpc",
          reqId: "r1",
          method: "creds.setup",
          params: { items: [{ tool: "claude", kind: "credentials", content: "x" }] },
        }),
      )?.type,
    ).toBe("rpc");
  });
});
