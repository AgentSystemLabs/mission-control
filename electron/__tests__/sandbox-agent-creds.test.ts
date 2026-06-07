import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Point os.homedir() at a temp dir and control the macOS Keychain read
// (`security` exec) deterministically so the test is hermetic on every platform.
const hoisted = vi.hoisted(() => ({
  home: "",
  execFileSync: vi.fn<(file: string, args: string[]) => string>(),
}));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => hoisted.home || actual.homedir() };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: (file: string, args: string[]) => hoisted.execFileSync(file, args) };
});

import { readHostAgentCreds } from "../sandbox-manager";

const execFileSyncMock = hoisted.execFileSync;
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-host-creds-"));
  hoisted.home = home;
  execFileSyncMock.mockReset();
});
afterEach(() => {
  hoisted.home = "";
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(home, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
function item(items: ReturnType<typeof readHostAgentCreds>, tool: string, kind: string) {
  return items.find((i) => i.tool === tool && i.kind === kind);
}

describe("readHostAgentCreds — keychain present (darwin-style)", () => {
  let platformSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  });

  afterEach(() => {
    platformSpy.mockRestore();
  });

  it("prefers Keychain for Claude + Cursor and builds the cursor auth blob", () => {
    execFileSyncMock.mockImplementation((_file, args) => {
      const svc = args[args.indexOf("-s") + 1];
      if (svc === "Claude Code-credentials") return "CLAUDE_KEYCHAIN_TOKEN\n";
      if (svc === "cursor-access-token") return "ACCESS\n";
      if (svc === "cursor-refresh-token") return "REFRESH\n";
      throw new Error("not found");
    });
    write(".codex/auth.json", "CODEX");
    write(".local/share/opencode/auth.json", "OPENCODE");

    const items = readHostAgentCreds();
    expect(item(items, "claude", "credentials")?.content).toBe("CLAUDE_KEYCHAIN_TOKEN");
    expect(JSON.parse(item(items, "cursor", "credentials")!.content)).toEqual({
      accessToken: "ACCESS",
      refreshToken: "REFRESH",
    });
    expect(item(items, "codex", "credentials")?.content).toBe("CODEX");
    expect(item(items, "opencode", "credentials")?.content).toBe("OPENCODE");
  });
});

describe("readHostAgentCreds — keychain empty (linux-style fallback)", () => {
  beforeEach(() => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("no keychain");
    });
  });

  it("falls back to credential files on disk", () => {
    write(".claude/.credentials.json", "CLAUDE_FILE_TOKEN");
    write(".config/cursor-agent/auth.json", "CURSOR_FILE");
    const items = readHostAgentCreds();
    expect(item(items, "claude", "credentials")?.content).toBe("CLAUDE_FILE_TOKEN");
    expect(item(items, "cursor", "credentials")?.content).toBe("CURSOR_FILE");
  });

  it("trims ~/.claude.json even when the source file exceeds MAX_CRED_BYTES", () => {
    const padding = "x".repeat(300 * 1024);
    write(
      ".claude.json",
      JSON.stringify({
        userID: "u1",
        oauthAccount: { emailAddress: "x@y.z" },
        hasCompletedOnboarding: true,
        projects: { "/secret/host/path": { history: [padding] } },
      }),
    );
    const state = item(readHostAgentCreds(), "claude", "state");
    expect(state).toBeDefined();
    const parsed = JSON.parse(state!.content);
    expect(parsed).toEqual({ userID: "u1", oauthAccount: { emailAddress: "x@y.z" }, hasCompletedOnboarding: true });
    expect(parsed).not.toHaveProperty("projects");
  });

  it("trims ~/.claude.json to the allow-listed auth/onboarding keys", () => {
    write(
      ".claude.json",
      JSON.stringify({
        userID: "u1",
        oauthAccount: { emailAddress: "x@y.z" },
        hasCompletedOnboarding: true,
        projects: { "/secret/host/path": { history: ["leak"] } },
        mcpServers: { local: { command: "/host/only" } },
      }),
    );
    const state = item(readHostAgentCreds(), "claude", "state");
    const parsed = JSON.parse(state!.content);
    expect(parsed).toEqual({ userID: "u1", oauthAccount: { emailAddress: "x@y.z" }, hasCompletedOnboarding: true });
    expect(parsed).not.toHaveProperty("projects");
    expect(parsed).not.toHaveProperty("mcpServers");
  });

  it("returns nothing when no host credentials exist", () => {
    expect(readHostAgentCreds()).toEqual([]);
  });
});
