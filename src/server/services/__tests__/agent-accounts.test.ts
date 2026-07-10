import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { _setAgentAccountsDepsForTests, readAgentAccounts } from "../agent-accounts";

let tmpHome: string;
const originalXdgDataHome = process.env.XDG_DATA_HOME;

function accountFor(agent: string) {
  return readAgentAccounts().find((entry) => entry.agent === agent)!;
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-accounts-"));
  process.env.XDG_DATA_HOME = path.join(tmpHome, ".local", "share");
  _setAgentAccountsDepsForTests({
    homeDir: () => tmpHome,
    codexReader: () => null,
    cursorReader: () => null,
  });
});

afterEach(() => {
  _setAgentAccountsDepsForTests({ homeDir: null, codexReader: null, cursorReader: null });
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdgDataHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("readAgentAccounts", () => {
  it("reports every agent disconnected when no auth artifacts exist", () => {
    expect(readAgentAccounts()).toEqual([
      { agent: "claude-code", connected: false, identifier: null },
      { agent: "codex", connected: false, identifier: null },
      { agent: "cursor-cli", connected: false, identifier: null },
      { agent: "opencode", connected: false, identifier: null },
    ]);
  });

  it("reads the Claude email from ~/.claude.json oauthAccount", () => {
    fs.writeFileSync(
      path.join(tmpHome, ".claude.json"),
      JSON.stringify({
        oauthAccount: { emailAddress: "dev@example.com", organizationName: "Acme" },
        projects: {},
      }),
    );
    expect(accountFor("claude-code")).toEqual({
      agent: "claude-code",
      connected: true,
      identifier: "dev@example.com",
    });
  });

  it("treats a Claude oauthAccount without an email as connected but anonymous", () => {
    fs.writeFileSync(
      path.join(tmpHome, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: "abc" } }),
    );
    expect(accountFor("claude-code")).toEqual({
      agent: "claude-code",
      connected: true,
      identifier: null,
    });
  });

  it("tolerates a malformed ~/.claude.json", () => {
    fs.writeFileSync(path.join(tmpHome, ".claude.json"), "{not json");
    expect(accountFor("claude-code")).toEqual({
      agent: "claude-code",
      connected: false,
      identifier: null,
    });
  });

  it("surfaces the Codex account id without any token material", () => {
    _setAgentAccountsDepsForTests({ codexReader: () => ({ accountId: "acct_123" }) });
    const account = accountFor("codex");
    expect(account).toEqual({ agent: "codex", connected: true, identifier: "acct_123" });
    expect(Object.keys(account).sort()).toEqual(["agent", "connected", "identifier"]);
  });

  it("surfaces the Cursor user id", () => {
    _setAgentAccountsDepsForTests({ cursorReader: () => "user_abc123" });
    expect(accountFor("cursor-cli")).toEqual({
      agent: "cursor-cli",
      connected: true,
      identifier: "user_abc123",
    });
  });

  it("detects OpenCode via its auth.json in XDG_DATA_HOME", () => {
    const opencodeDir = path.join(process.env.XDG_DATA_HOME!, "opencode");
    fs.mkdirSync(opencodeDir, { recursive: true });
    fs.writeFileSync(path.join(opencodeDir, "auth.json"), "{}");
    expect(accountFor("opencode")).toEqual({
      agent: "opencode",
      connected: true,
      identifier: null,
    });
  });

  it("never includes token-shaped fields in the payload", () => {
    _setAgentAccountsDepsForTests({
      codexReader: () => ({ accountId: "acct_123" }),
      cursorReader: () => "user_abc123",
    });
    const serialized = JSON.stringify(readAgentAccounts()).toLowerCase();
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
  });
});
