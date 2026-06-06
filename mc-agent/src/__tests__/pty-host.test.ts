import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IPty } from "node-pty";
import { PtyHost } from "../pty-host";
import type { ServerMessage, SpawnMessage } from "../protocol";

type FakePty = {
  dataCbs: ((d: string) => void)[];
  exitCbs: ((e: { exitCode: number; signal?: number }) => void)[];
  writes: string[];
  resizes: [number, number][];
  killed: boolean;
};

function makeFakeSpawn() {
  const created: FakePty[] = [];
  const spawnFn = ((file: string) => {
    const state: FakePty = { dataCbs: [], exitCbs: [], writes: [], resizes: [], killed: false };
    created.push(state);
    const ipty = {
      onData: (cb: (d: string) => void) => {
        state.dataCbs.push(cb);
        return { dispose() {} };
      },
      onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
        state.exitCbs.push(cb);
        return { dispose() {} };
      },
      write: (d: string) => state.writes.push(d),
      resize: (c: number, r: number) => state.resizes.push([c, r]),
      kill: () => {
        state.killed = true;
      },
      clear() {},
      pause() {},
      resume() {},
      on() {},
      pid: 4242,
      cols: 80,
      rows: 24,
      process: file,
      handleFlowControl: false,
    };
    return ipty as unknown as IPty;
  }) as unknown as typeof import("node-pty").spawn;
  return { spawnFn, created };
}

let workspace: string;
let messages: ServerMessage[];
let created: FakePty[];
let host: PtyHost;

function shellSpawn(overrides: Partial<SpawnMessage> = {}): SpawnMessage {
  return {
    type: "spawn",
    ptyId: "p1",
    taskId: "t1",
    cwd: workspace,
    command: "",
    shell: true,
    ...overrides,
  };
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mc-pty-"));
  messages = [];
  const fake = makeFakeSpawn();
  created = fake.created;
  host = new PtyHost((m) => messages.push(m), { workspaceRoot: workspace, spawnFn: fake.spawnFn });
});

afterEach(() => {
  host.killAll();
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("PtyHost spawn + lifecycle", () => {
  it("spawns a shell and acks with `spawned`", () => {
    host.spawn(shellSpawn());
    expect(created.length).toBe(1);
    expect(messages).toContainEqual({ type: "spawned", ptyId: "p1" });
  });

  it("emits seq-numbered output and replays the buffer", () => {
    host.spawn(shellSpawn());
    created[0]!.dataCbs[0]!("hello");
    created[0]!.dataCbs[0]!("world");
    const outputs = messages.filter((m) => m.type === "output");
    expect(outputs).toEqual([
      { type: "output", ptyId: "p1", seq: 1, data: "hello" },
      { type: "output", ptyId: "p1", seq: 2, data: "world" },
    ]);

    host.replay("p1");
    // nextSeq = "the seq the next chunk will get" = lastSeq + 1 (host parity).
    expect(messages).toContainEqual({
      type: "replayResult",
      ptyId: "p1",
      data: "helloworld",
      nextSeq: 3,
    });
  });

  it("routes write/resize/kill to the pty and reports unknown ids", () => {
    host.spawn(shellSpawn());
    expect(host.write("p1", "ls\n")).toBe(true);
    expect(created[0]!.writes).toContain("ls\n");
    expect(host.resize("p1", 120, 40)).toBe(true);
    expect(created[0]!.resizes).toContainEqual([120, 40]);
    expect(host.kill("p1")).toBe(true);
    expect(created[0]!.killed).toBe(true);
    // After kill the pty is gone.
    expect(host.write("p1", "x")).toBe(false);
    expect(host.kill("unknown")).toBe(false);
  });

  it("emits exit and drops the pty", () => {
    host.spawn(shellSpawn({ ptyId: "p2" }));
    created[0]!.exitCbs[0]!({ exitCode: 0 });
    expect(messages).toContainEqual({ type: "exit", ptyId: "p2", exitCode: 0, signal: undefined });
    expect(host.write("p2", "x")).toBe(false);
  });

  it("creates a missing workspace cwd so an un-cloned project still opens", () => {
    const fresh = path.join(workspace, "not-cloned-yet");
    expect(fs.existsSync(fresh)).toBe(false);
    host.spawn(shellSpawn({ ptyId: "p4", cwd: fresh }));
    expect(fs.existsSync(fresh)).toBe(true);
    expect(messages).toContainEqual({ type: "spawned", ptyId: "p4" });
    expect(messages.find((m) => m.type === "spawnError")).toBeUndefined();
  });

  it("rejects a cwd outside the workspace with spawnError", () => {
    host.spawn(shellSpawn({ cwd: os.homedir() }));
    const err = messages.find((m) => m.type === "spawnError");
    expect(err).toBeDefined();
    if (err && err.type === "spawnError") {
      expect(err.code).toBe("cwd-outside-project-roots");
    }
    expect(created.length).toBe(0);
  });

  it("opens a project-less home terminal at the agent's home dir, ignoring the supplied cwd", () => {
    // A dashboard "home" terminal targeting a Remote VM: the renderer sends an
    // empty cwd + home flag; the agent resolves it to its own home and spawns
    // there even though that's outside the workspace root.
    host.spawn(shellSpawn({ ptyId: "p9", cwd: "", home: true }));
    expect(messages).toContainEqual({ type: "spawned", ptyId: "p9" });
    expect(messages.find((m) => m.type === "spawnError")).toBeUndefined();
    expect(created.length).toBe(1);
  });
});
