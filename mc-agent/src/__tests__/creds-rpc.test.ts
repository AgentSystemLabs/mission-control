import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CredsRpc } from "../creds-rpc";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-creds-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}
function read(...segs: string[]): string {
  return fs.readFileSync(path.join(home, ...segs), "utf8");
}

describe("CredsRpc default (no env overrides)", () => {
  it("writes each tool's credentials to the canonical path with 0600", async () => {
    const rpc = new CredsRpc(home, {});
    const r = await rpc.setup({
      items: [
        { tool: "claude", kind: "credentials", content: "CLAUDE_TOKEN" },
        { tool: "codex", kind: "credentials", content: "CODEX_AUTH" },
        { tool: "cursor", kind: "credentials", content: '{"accessToken":"a"}' },
        { tool: "opencode", kind: "credentials", content: "OPENCODE_AUTH" },
      ],
    });
    expect(r.wrote).toBe(4);
    expect(read(".claude", ".credentials.json")).toBe("CLAUDE_TOKEN");
    expect(read(".codex", "auth.json")).toBe("CODEX_AUTH");
    expect(read(".config", "cursor-agent", "auth.json")).toBe('{"accessToken":"a"}');
    expect(read(".local", "share", "opencode", "auth.json")).toBe("OPENCODE_AUTH");
    expect(mode(path.join(home, ".claude", ".credentials.json"))).toBe(0o600);
    expect(mode(path.join(home, ".codex", "auth.json"))).toBe(0o600);
  });

  it("writes claude state to ~/.claude.json when CLAUDE_CONFIG_DIR is unset", async () => {
    const rpc = new CredsRpc(home, {});
    await rpc.setup({ items: [{ tool: "claude", kind: "state", content: '{"userID":"u1"}' }] });
    expect(JSON.parse(read(".claude.json"))).toEqual({ userID: "u1" });
  });
});

describe("CredsRpc with CLAUDE_CONFIG_DIR / XDG overrides", () => {
  it("places claude credentials + state inside CLAUDE_CONFIG_DIR", async () => {
    const cfg = path.join(home, "claude-cfg");
    const rpc = new CredsRpc(home, { CLAUDE_CONFIG_DIR: cfg });
    await rpc.setup({
      items: [
        { tool: "claude", kind: "credentials", content: "TOK" },
        { tool: "claude", kind: "state", content: '{"userID":"u"}' },
      ],
    });
    expect(fs.readFileSync(path.join(cfg, ".credentials.json"), "utf8")).toBe("TOK");
    expect(fs.existsSync(path.join(cfg, ".claude.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".claude.json"))).toBe(false);
  });

  it("honors XDG_CONFIG_HOME / XDG_DATA_HOME for cursor + opencode", async () => {
    const rpc = new CredsRpc(home, {
      XDG_CONFIG_HOME: path.join(home, "xcfg"),
      XDG_DATA_HOME: path.join(home, "xdata"),
    });
    await rpc.setup({
      items: [
        { tool: "cursor", kind: "credentials", content: "C" },
        { tool: "opencode", kind: "credentials", content: "O" },
      ],
    });
    expect(fs.readFileSync(path.join(home, "xcfg", "cursor-agent", "auth.json"), "utf8")).toBe("C");
    expect(fs.readFileSync(path.join(home, "xdata", "opencode", "auth.json"), "utf8")).toBe("O");
  });
});

describe("CredsRpc claude state merge", () => {
  it("shallow-merges over an existing .claude.json without clobbering other keys", async () => {
    const existing = path.join(home, ".claude.json");
    fs.writeFileSync(existing, JSON.stringify({ keep: 1, userID: "old" }));
    const rpc = new CredsRpc(home, {});
    await rpc.setup({
      items: [{ tool: "claude", kind: "state", content: '{"userID":"new","added":true}' }],
    });
    expect(JSON.parse(read(".claude.json"))).toEqual({ keep: 1, userID: "new", added: true });
  });
});

describe("CredsRpc validation", () => {
  it("skips unknown tool/kind, empty, and oversized content", async () => {
    const rpc = new CredsRpc(home, {});
    const r = await rpc.setup({
      items: [
        // unknown tool / kind
        { tool: "evil" as never, kind: "credentials", content: "x" },
        { tool: "claude", kind: "config" as never, content: "x" },
        // empty + oversized
        { tool: "codex", kind: "credentials", content: "" },
        { tool: "opencode", kind: "credentials", content: "z".repeat(256 * 1024 + 1) },
        // one valid item
        { tool: "cursor", kind: "credentials", content: "ok" },
      ],
    });
    expect(r.wrote).toBe(1);
    expect(fs.existsSync(path.join(home, ".codex", "auth.json"))).toBe(false);
    expect(read(".config", "cursor-agent", "auth.json")).toBe("ok");
  });

  it("tolerates a non-array items payload", async () => {
    const rpc = new CredsRpc(home, {});
    const r = await rpc.setup({ items: undefined as never });
    expect(r.wrote).toBe(0);
  });
});
