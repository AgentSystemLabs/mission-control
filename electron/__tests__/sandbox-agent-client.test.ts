import { describe, it, expect, vi, afterEach } from "vitest";
import { SandboxAgentClient, type WebSocketLike } from "../sandbox-agent-client";

type Listener = (...args: unknown[]) => void;

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Listener[]> = {};
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }
  on(event: string, cb: Listener): void {
    (this.listeners[event] ??= []).push(cb);
  }
  removeAllListeners(): void {
    this.listeners = {};
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners[event] ?? []) cb(...args);
  }
  deliver(obj: unknown): void {
    this.emit("message", JSON.stringify(obj));
  }
  lastSent(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]!);
  }
}

function makeClient(handlers = {}, opts = {}) {
  const fake = new FakeSocket();
  const client = new SandboxAgentClient("ws://x", "tok", handlers, {
    createSocket: () => fake as unknown as WebSocketLike,
    ...opts,
  });
  return { client, fake };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SandboxAgentClient RPC correlation", () => {
  it("resolves an rpc when a matching rpcResult arrives", async () => {
    const { client, fake } = makeClient();
    const p = client.rpc("git.status", { repo: "/workspace/x" });
    const sent = fake.lastSent();
    expect(sent.type).toBe("rpc");
    expect(sent.method).toBe("git.status");
    fake.deliver({ type: "rpcResult", reqId: sent.reqId, ok: true, result: { branch: "main" } });
    await expect(p).resolves.toEqual({ branch: "main" });
  });

  it("rejects an rpc on ok:false", async () => {
    const { client, fake } = makeClient();
    const p = client.rpc("fs.read", { path: "/workspace/x/a" });
    fake.deliver({ type: "rpcResult", reqId: fake.lastSent().reqId, ok: false, error: "not-found" });
    await expect(p).rejects.toThrow(/not-found/);
  });

  it("ignores an rpcResult for an unknown reqId", async () => {
    const { client, fake } = makeClient();
    const p = client.rpc("git.status", { repo: "/workspace/x" });
    fake.deliver({ type: "rpcResult", reqId: "bogus", ok: true, result: 1 });
    // still pending — resolve the real one
    fake.deliver({ type: "rpcResult", reqId: fake.lastSent().reqId, ok: true, result: 2 });
    await expect(p).resolves.toBe(2);
  });

  it("times out a stuck rpc", async () => {
    vi.useFakeTimers();
    const { client } = makeClient({}, { rpcTimeoutMs: 50 });
    const p = client.rpc("git.clone", { remote: "https://x", slug: "y" });
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it("rejects an rpc while the socket is not open", async () => {
    const { client, fake } = makeClient();
    fake.readyState = 0;
    await expect(client.rpc("git.status", { repo: "/workspace/x" })).rejects.toThrow(/not open/);
    expect(fake.sent).toHaveLength(0);
  });
});

describe("SandboxAgentClient PTY control frames", () => {
  it("sends spawn/write/resize/kill/replay frames", () => {
    const { client, fake } = makeClient();
    client.spawn({ ptyId: "p1", taskId: "t1", cwd: "/workspace/x", command: "claude", agent: "claude-code" });
    expect(fake.lastSent()).toMatchObject({ type: "spawn", ptyId: "p1", command: "claude" });
    client.write("p1", "ls\n");
    expect(fake.lastSent()).toEqual({ type: "write", ptyId: "p1", data: "ls\n" });
    client.resize("p1", 120, 40);
    expect(fake.lastSent()).toEqual({ type: "resize", ptyId: "p1", cols: 120, rows: 40 });
    client.kill("p1");
    expect(fake.lastSent()).toEqual({ type: "kill", ptyId: "p1" });
    client.replay("p1");
    expect(fake.lastSent()).toEqual({ type: "replay", ptyId: "p1" });
  });
});

describe("SandboxAgentClient stream dispatch", () => {
  it("routes ready/spawned/output/exit/fs.change to handlers", () => {
    const calls: string[] = [];
    const { fake } = makeClient({
      onReady: (v: string) => calls.push(`ready:${v}`),
      onSpawned: (id: string) => calls.push(`spawned:${id}`),
      onOutput: (id: string, seq: number, data: string) => calls.push(`out:${id}:${seq}:${data}`),
      onExit: (id: string, code?: number) => calls.push(`exit:${id}:${code}`),
      onFsChange: (w: string) => calls.push(`fs:${w}`),
    });
    fake.deliver({ type: "ready", version: "0.1.0", agents: {} });
    fake.deliver({ type: "spawned", ptyId: "p1" });
    fake.deliver({ type: "output", ptyId: "p1", seq: 1, data: "hi" });
    fake.deliver({ type: "exit", ptyId: "p1", exitCode: 0 });
    fake.deliver({ type: "fs.change", watchId: "w1", path: "/workspace/x/a", mtimeMs: 123 });
    expect(calls).toEqual(["ready:0.1.0", "spawned:p1", "out:p1:1:hi", "exit:p1:0", "fs:w1"]);
  });

  it("ignores malformed frames", () => {
    const onOutput = vi.fn();
    const { fake } = makeClient({ onOutput });
    fake.emit("message", "not json");
    fake.deliver({ noType: true });
    fake.deliver({ type: "output", ptyId: "p1" }); // missing seq
    expect(onOutput).not.toHaveBeenCalled();
  });
});

describe("SandboxAgentClient close", () => {
  it("rejects pending rpcs and fires onClose on socket close", async () => {
    const onClose = vi.fn();
    const { client, fake } = makeClient({ onClose });
    const p = client.rpc("git.status", { repo: "/workspace/x" });
    fake.close();
    await expect(p).rejects.toThrow(/closed/);
    expect(onClose).toHaveBeenCalledOnce();
    expect(client.isOpen).toBe(false);
  });

  it("explicit close() rejects pending and stops sending", async () => {
    const { client, fake } = makeClient();
    const p = client.rpc("git.status", { repo: "/workspace/x" });
    client.close();
    await expect(p).rejects.toThrow(/closed/);
    const before = fake.sent.length;
    client.write("p1", "x");
    expect(fake.sent.length).toBe(before); // no send after close
  });
});
