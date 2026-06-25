import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { IPC } from "../ipc-channels";
import { __resetIpcAllowedOriginsForTesting, configureIpcAllowedOrigins } from "../ipc-safe-handle";

vi.mock("electron", () => ({
  ipcMain: {},
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

import { registerFileHandlers } from "../file-handlers";

type Handler = (event: any, ...args: any[]) => unknown;

function makeAllowedEvent() {
  const frame: { url: string; top: any } = { url: "http://localhost:5173/projects/1", top: null };
  frame.top = frame;
  return { senderFrame: frame };
}

function makeIpc() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipc: {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler);
      },
    },
  };
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");
}

describe("files:read line limit", () => {
  let root: string;

  beforeEach(() => {
    __resetIpcAllowedOriginsForTesting();
    configureIpcAllowedOrigins(["http://localhost:5173"]);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-file-read-limit-"));
  });

  afterEach(() => {
    __resetIpcAllowedOriginsForTesting();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("opens text files up to 10,000 lines", async () => {
    fs.writeFileSync(path.join(root, "large.ts"), numberedLines(10_000), "utf8");
    const { handlers, ipc } = makeIpc();
    registerFileHandlers(ipc as any, () => null);

    const read = handlers.get(IPC.filesRead);
    expect(read).toBeDefined();

    const result = await read!(makeAllowedEvent(), root, "large.ts");
    expect(result).toMatchObject({ ok: true, kind: "text", lineCount: 10_000 });
  });

  it("rejects text files over 10,000 lines", async () => {
    fs.writeFileSync(path.join(root, "too-large.ts"), numberedLines(10_001), "utf8");
    const { handlers, ipc } = makeIpc();
    registerFileHandlers(ipc as any, () => null);

    const read = handlers.get(IPC.filesRead);
    expect(read).toBeDefined();

    const result = await read!(makeAllowedEvent(), root, "too-large.ts");
    expect(result).toMatchObject({ ok: false, error: "too-large", lineCount: 10_001 });
  });
});
