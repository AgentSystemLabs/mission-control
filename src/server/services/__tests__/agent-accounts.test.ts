import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { _setAgentAccountsDepsForTests, readAgentAccounts } from "../agent-accounts";

let tmpHome: string;
const originalXdgDataHome = process.env.XDG_DATA_HOME;
const originalGrokHome = process.env.GROK_HOME;
const originalGrokAuthPath = process.env.GROK_AUTH_PATH;
const originalGrokAuth = process.env.GROK_AUTH;
const originalXaiApiKey = process.env.XAI_API_KEY;
const originalLegacyXaiApiKey = process.env.GROK_CODE_XAI_API_KEY;

function accountFor(agent: string) {
  return readAgentAccounts().find((entry) => entry.agent === agent)!;
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-accounts-"));
  process.env.XDG_DATA_HOME = path.join(tmpHome, ".local", "share");
  delete process.env.GROK_HOME;
  delete process.env.GROK_AUTH_PATH;
  delete process.env.GROK_AUTH;
  delete process.env.XAI_API_KEY;
  delete process.env.GROK_CODE_XAI_API_KEY;
  _setAgentAccountsDepsForTests({
    homeDir: () => tmpHome,
    codexReader: () => null,
    cursorReader: () => null,
    environmentReader: () => process.env,
  });
});

afterEach(() => {
  _setAgentAccountsDepsForTests({
    homeDir: null,
    codexReader: null,
    cursorReader: null,
    environmentReader: null,
  });
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdgDataHome;
  if (originalGrokHome === undefined) delete process.env.GROK_HOME;
  else process.env.GROK_HOME = originalGrokHome;
  if (originalGrokAuthPath === undefined) delete process.env.GROK_AUTH_PATH;
  else process.env.GROK_AUTH_PATH = originalGrokAuthPath;
  if (originalGrokAuth === undefined) delete process.env.GROK_AUTH;
  else process.env.GROK_AUTH = originalGrokAuth;
  if (originalXaiApiKey === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = originalXaiApiKey;
  if (originalLegacyXaiApiKey === undefined) delete process.env.GROK_CODE_XAI_API_KEY;
  else process.env.GROK_CODE_XAI_API_KEY = originalLegacyXaiApiKey;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("readAgentAccounts", () => {
  it("reports every agent disconnected when no auth artifacts exist", () => {
    expect(readAgentAccounts()).toEqual([
      { agent: "claude-code", connected: false, identifier: null },
      { agent: "codex", connected: false, identifier: null },
      { agent: "grok", connected: false, identifier: null },
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

  it("reads the Grok Build account without exposing credentials", () => {
    const grokHome = path.join(tmpHome, ".grok");
    fs.mkdirSync(grokHome, { recursive: true });
    fs.writeFileSync(
      path.join(grokHome, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::client": {
          key: "access-secret",
          refresh_token: "refresh-secret",
          auth_mode: "oidc",
          email: "grok-dev@example.com",
          user_id: "user-123",
        },
      }),
    );

    const account = accountFor("grok");
    expect(account).toEqual({
      agent: "grok",
      connected: true,
      identifier: "grok-dev@example.com",
    });
    expect(JSON.stringify(account)).not.toContain("secret");
  });

  it("honors GROK_HOME and GROK_AUTH_PATH", () => {
    const grokHome = path.join(tmpHome, "custom-grok-home");
    const authPath = path.join(tmpHome, "custom-auth.json");
    process.env.GROK_HOME = grokHome;
    process.env.GROK_AUTH_PATH = authPath;
    fs.mkdirSync(grokHome, { recursive: true });
    fs.writeFileSync(
      path.join(grokHome, "auth.json"),
      JSON.stringify({ ignored: { key: "wrong", email: "wrong@example.com" } }),
    );
    fs.writeFileSync(
      authPath,
      JSON.stringify({ selected: { key: "right", user_id: "grok-user" } }),
    );

    expect(accountFor("grok")).toEqual({
      agent: "grok",
      connected: true,
      identifier: "grok-user",
    });
  });

  it("honors Grok environment resolved from the user's login shell", () => {
    const grokHome = path.join(tmpHome, "shell-grok-home");
    fs.mkdirSync(grokHome, { recursive: true });
    fs.writeFileSync(
      path.join(grokHome, "auth.json"),
      JSON.stringify({ shell: { key: "shell-credential", user_id: "shell-user" } }),
    );
    _setAgentAccountsDepsForTests({
      environmentReader: () => ({ GROK_HOME: grokHome }),
    });

    expect(accountFor("grok")).toEqual({
      agent: "grok",
      connected: true,
      identifier: "shell-user",
    });
  });

  it("reads inline GROK_AUTH before the auth file", () => {
    const grokHome = path.join(tmpHome, ".grok");
    fs.mkdirSync(grokHome, { recursive: true });
    fs.writeFileSync(
      path.join(grokHome, "auth.json"),
      JSON.stringify({ file: { key: "file-credential", email: "file@example.com" } }),
    );
    process.env.GROK_AUTH = JSON.stringify({
      key: "inline-credential",
      auth_mode: "oidc",
      create_time: "2026-07-31T00:00:00Z",
      user_id: "inline-user",
      email: "inline@example.com",
    });

    expect(accountFor("grok")).toEqual({
      agent: "grok",
      connected: true,
      identifier: "inline@example.com",
    });
  });

  it("falls back to the auth file when GROK_AUTH is malformed", () => {
    const grokHome = path.join(tmpHome, ".grok");
    fs.mkdirSync(grokHome, { recursive: true });
    fs.writeFileSync(
      path.join(grokHome, "auth.json"),
      JSON.stringify({ file: { key: "file-credential", user_id: "file-user" } }),
    );
    process.env.GROK_AUTH = "{malformed";

    expect(accountFor("grok")).toEqual({
      agent: "grok",
      connected: true,
      identifier: "file-user",
    });
  });

  it.each(["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"] as const)(
    "recognizes %s without exposing its value",
    (variable) => {
      process.env[variable] = "environment-secret";

      const account = accountFor("grok");
      expect(account).toEqual({ agent: "grok", connected: true, identifier: null });
      expect(JSON.stringify(account)).not.toContain("environment-secret");
    },
  );

  it("treats malformed or credential-free Grok auth as disconnected", () => {
    const grokHome = path.join(tmpHome, ".grok");
    fs.mkdirSync(grokHome, { recursive: true });
    const authPath = path.join(grokHome, "auth.json");
    fs.writeFileSync(authPath, "{not-json");
    expect(accountFor("grok").connected).toBe(false);

    fs.writeFileSync(authPath, JSON.stringify({ scope: { email: "no-token@example.com" } }));
    expect(accountFor("grok").connected).toBe(false);
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
