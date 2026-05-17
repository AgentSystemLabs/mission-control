import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: {} }));
vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

import {
  configureIpcAllowedOrigins,
  isFrameAllowed,
  safeHandle,
  __resetIpcAllowedOriginsForTesting,
  type FrameLike,
} from "../ipc-safe-handle";

type Handler = (event: any, ...args: any[]) => unknown;

function makeIpc() {
  const registered = new Map<string, Handler>();
  const ipc = {
    handle(channel: string, fn: Handler) {
      registered.set(channel, fn);
    },
    invoke(channel: string, event: any, ...args: any[]) {
      const fn = registered.get(channel);
      if (!fn) throw new Error(`no handler for ${channel}`);
      return fn(event, ...args);
    },
  };
  return ipc;
}

function topFrame(url: string): FrameLike {
  const frame: any = { url };
  frame.top = frame;
  return frame as FrameLike;
}

function subFrame(parentUrl: string, childUrl: string): { frame: FrameLike; top: FrameLike } {
  const top: any = { url: parentUrl };
  top.top = top;
  const child: any = { url: childUrl, top };
  return { frame: child as FrameLike, top };
}

describe("isFrameAllowed", () => {
  beforeEach(() => {
    __resetIpcAllowedOriginsForTesting();
  });

  it("rejects when no origins are configured", () => {
    expect(isFrameAllowed(topFrame("http://127.0.0.1:5173/"))).toBe(false);
  });

  it("accepts the configured origin on the top frame", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    expect(isFrameAllowed(topFrame("http://127.0.0.1:5173/projects/abc"))).toBe(true);
  });

  it("rejects a different host", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    expect(isFrameAllowed(topFrame("http://evil.example.com/"))).toBe(false);
  });

  it("rejects a different port", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    expect(isFrameAllowed(topFrame("http://127.0.0.1:6000/"))).toBe(false);
  });

  it("rejects a different scheme", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    expect(isFrameAllowed(topFrame("file:///etc/passwd"))).toBe(false);
  });

  it("rejects a sub-frame even when its URL matches an allowed origin", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    const { frame } = subFrame("http://127.0.0.1:5173/", "http://127.0.0.1:5173/iframe");
    expect(isFrameAllowed(frame)).toBe(false);
  });

  it("rejects a null frame (destroyed)", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    expect(isFrameAllowed(null)).toBe(false);
  });

  it("normalizes the configured URL to its WHATWG origin", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173/some/path"]);
    expect(isFrameAllowed(topFrame("http://127.0.0.1:5173/different/path"))).toBe(true);
  });

  it("ignores malformed configured entries", () => {
    configureIpcAllowedOrigins(["not a url", "http://127.0.0.1:5173"]);
    expect(isFrameAllowed(topFrame("http://127.0.0.1:5173/"))).toBe(true);
  });
});

describe("configureIpcAllowedOrigins", () => {
  beforeEach(() => {
    __resetIpcAllowedOriginsForTesting();
  });

  it("throws when called twice (one-shot trust root)", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    expect(() => configureIpcAllowedOrigins(["http://other.example.com"])).toThrow(/already configured/);
  });
});

describe("safeHandle", () => {
  beforeEach(() => {
    __resetIpcAllowedOriginsForTesting();
  });

  it("invokes the wrapped handler when the frame is allowed", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    const ipc = makeIpc();
    const inner = vi.fn().mockReturnValue("ok");
    safeHandle("test:channel", inner, ipc as any);

    const result = ipc.invoke("test:channel", { senderFrame: topFrame("http://127.0.0.1:5173/") }, "arg1");

    expect(inner).toHaveBeenCalledOnce();
    expect(result).toBe("ok");
  });

  it("throws and skips the handler when the frame is off-origin", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    const ipc = makeIpc();
    const inner = vi.fn();
    safeHandle("test:channel", inner, ipc as any);

    expect(() =>
      ipc.invoke("test:channel", { senderFrame: topFrame("http://evil.example.com/") }),
    ).toThrow(/rejected sender/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("error thrown to renderer does not echo path or query string", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    const ipc = makeIpc();
    safeHandle("test:channel", () => "ok", ipc as any);

    try {
      ipc.invoke("test:channel", {
        senderFrame: topFrame("http://evil.example.com/secret?token=hunter2"),
      });
      expect.fail("expected throw");
    } catch (err: any) {
      expect(err.message).not.toContain("hunter2");
      expect(err.message).not.toContain("/secret");
      expect(err.message).toContain("http://evil.example.com");
    }
  });

  it("throws and skips the handler when the sender is a sub-frame", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    const ipc = makeIpc();
    const inner = vi.fn();
    safeHandle("test:channel", inner, ipc as any);

    const { frame } = subFrame("http://127.0.0.1:5173/", "http://127.0.0.1:5173/inner");
    expect(() => ipc.invoke("test:channel", { senderFrame: frame })).toThrow(/rejected sender/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("throws when senderFrame is null", () => {
    configureIpcAllowedOrigins(["http://127.0.0.1:5173"]);
    const ipc = makeIpc();
    const inner = vi.fn();
    safeHandle("test:channel", inner, ipc as any);

    expect(() => ipc.invoke("test:channel", { senderFrame: null })).toThrow(/rejected sender/);
    expect(inner).not.toHaveBeenCalled();
  });
});
