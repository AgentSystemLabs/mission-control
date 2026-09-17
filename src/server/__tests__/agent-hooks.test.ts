import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { installAgentHooks } from "../../../electron/agent-hooks";

// Every PowerShell on PATH: pwsh (preinstalled on the CI runners) and, on
// Windows, Windows PowerShell 5.1 — the host issue #130 was reported against.
const POWERSHELLS = (process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"]).filter(
  (bin) =>
    spawnSync(bin, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { stdio: "ignore" })
      .status === 0,
);

/** Install the Windows Claude hooks into a temp project and look commands up by event. */
function windowsClaudeHookCommands(): (event: string, matcher?: string) => string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));
  installAgentHooks("claude-code", cwd, "win32");
  const settings = JSON.parse(
    fs.readFileSync(path.join(cwd, ".claude", "settings.local.json"), "utf8"),
  ) as {
    hooks: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
  };
  return (event, matcher) =>
    settings.hooks[event]?.find((g) => matcher === undefined || g.matcher === matcher)
      ?.hooks?.[0]?.command ?? "";
}

function runHook(
  bin: string,
  command: string,
  stdin: Buffer,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-NoProfile", "-NonInteractive", "-Command", command], { env });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }),
    );
    child.stdin.end(stdin);
  });
}

describe("agent hook installation", () => {
  it("does not register Claude interrupt hooks", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("claude-code", cwd);

    const raw = fs.readFileSync(
      path.join(cwd, ".claude", "settings.local.json"),
      "utf8"
    );
    const settings = JSON.parse(raw) as {
      hooks: Record<string, Array<{ _mcManaged?: boolean }>>;
    };

    expect(settings.hooks.UserInterrupt).toBeUndefined();
  });

  it("removes stale managed Claude interrupt hooks", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));
    const file = path.join(cwd, ".claude", "settings.local.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          UserInterrupt: [{ hooks: [], _mcManaged: true }],
        },
      }),
      "utf8"
    );

    installAgentHooks("claude-code", cwd);

    const settings = JSON.parse(fs.readFileSync(file, "utf8")) as {
      hooks: Record<string, unknown>;
    };
    expect(settings.hooks.UserInterrupt).toBeUndefined();
  });

  it("registers AskUserQuestion tool-use hooks for Claude", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("claude-code", cwd);

    const raw = fs.readFileSync(
      path.join(cwd, ".claude", "settings.local.json"),
      "utf8"
    );
    const settings = JSON.parse(raw) as {
      hooks: Record<
        string,
        Array<{
          matcher?: string;
          hooks?: Array<{ command?: string }>;
          _mcManaged?: boolean;
        }>
      >;
    };

    expect(settings.hooks.PreToolUse?.[0]).toMatchObject({
      matcher: "AskUserQuestion",
      _mcManaged: true,
    });
    expect(settings.hooks.PreToolUse?.[0]?.hooks?.[0]?.command).toContain(
      "hookEvent=PreToolUse"
    );
    expect(settings.hooks.PostToolUse?.[0]).toMatchObject({
      matcher: "AskUserQuestion",
      _mcManaged: true,
    });
    expect(settings.hooks.PostToolUse?.[0]?.hooks?.[0]?.command).toContain(
      "hookEvent=PostToolUse"
    );
  });

  it("registers a SessionStart hook and passes UserPromptSubmit stdout through", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("claude-code", cwd);

    const settings = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude", "settings.local.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };

    // SessionStart drives the code-graph auto-index and keeps stdout so the
    // server can answer it with the Session Brief fallback.
    const sessionStart = settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command ?? "";
    expect(sessionStart).toContain("hookEvent=SessionStart");
    expect(sessionStart).not.toContain(">/dev/null 2>&1");
    expect(sessionStart).toContain("2>/dev/null || true");

    // UserPromptSubmit keeps stdout (the injected recall block); Stop discards it.
    const userPrompt = settings.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command ?? "";
    expect(userPrompt).toContain("hookEvent=UserPromptSubmit");
    expect(userPrompt).not.toContain(">/dev/null 2>&1");
    expect(userPrompt).toContain("2>/dev/null || true");

    const stop = settings.hooks.Stop?.[0]?.hooks?.[0]?.command ?? "";
    expect(stop).toContain(">/dev/null 2>&1 || true");
  });

  it("registers subagent lifecycle hooks for Claude", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("claude-code", cwd);

    const settings = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude", "settings.local.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }>; _mcManaged?: boolean }>>;
    };

    // Background subagents outlive the foreground turn's Stop; the server
    // counts these to hold the session on "running" until the last one is done.
    const start = settings.hooks.SubagentStart?.[0];
    expect(start?._mcManaged).toBe(true);
    expect(start?.hooks?.[0]?.command).toContain("hookEvent=SubagentStart");
    const stop = settings.hooks.SubagentStop?.[0];
    expect(stop?._mcManaged).toBe(true);
    expect(stop?.hooks?.[0]?.command).toContain("hookEvent=SubagentStop");
    // Status-only events: output is discarded.
    expect(stop?.hooks?.[0]?.command).toContain(">/dev/null 2>&1 || true");
  });

  it("replaces a legacy managed SubagentStop entry instead of stripping it", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));
    const file = path.join(cwd, ".claude", "settings.local.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          SubagentStop: [{ hooks: [], _mcManaged: true }],
        },
      }),
      "utf8",
    );

    installAgentHooks("claude-code", cwd);

    const settings = JSON.parse(fs.readFileSync(file, "utf8")) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    expect(settings.hooks.SubagentStop).toHaveLength(1);
    expect(settings.hooks.SubagentStop?.[0]?.hooks?.[0]?.command).toContain(
      "hookEvent=SubagentStop",
    );
  });

  it("removes legacy marker-less Mission Control hook groups but keeps user hooks", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));
    const file = path.join(cwd, ".claude", "settings.local.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // A pre-marker installer wrote MC hook entries without _mcManaged; they must
    // be recognized by their MC endpoint command and replaced, while a genuine
    // user hook in the same event survives untouched.
    const legacyCommand =
      'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ]; then exit 0; fi; ' +
      'curl -sS -m 3 -X POST --data-binary @- "$MC_API_URL/api/hooks/claude?taskId=$MC_TASK_ID&hookEvent=UserPromptSubmit" >/dev/null 2>&1 || true';
    const userHook = { hooks: [{ type: "command", command: "echo my-own-hook" }] };
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: legacyCommand }] },
            { hooks: [{ type: "command", command: legacyCommand }] },
            userHook,
          ],
          // Legacy entries under a retired event must be swept out too.
          UserInterrupt: [{ hooks: [{ type: "command", command: legacyCommand }] }],
        },
      }),
      "utf8",
    );

    installAgentHooks("claude-code", cwd);

    const settings = JSON.parse(fs.readFileSync(file, "utf8")) as {
      hooks: Record<
        string,
        Array<{ hooks?: Array<{ command?: string }>; _mcManaged?: boolean }>
      >;
    };

    const groups = settings.hooks.UserPromptSubmit ?? [];
    expect(groups).toHaveLength(2);
    expect(groups[0]?.hooks?.[0]?.command).toBe("echo my-own-hook");
    expect(groups[0]?._mcManaged).toBeUndefined();
    expect(groups[1]?._mcManaged).toBe(true);
    expect(settings.hooks.UserInterrupt).toBeUndefined();
  });

  it("registers Claude hooks as PowerShell commands on Windows", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("claude-code", cwd, "win32");

    const raw = fs.readFileSync(
      path.join(cwd, ".claude", "settings.local.json"),
      "utf8"
    );
    const settings = JSON.parse(raw) as {
      hooks: Record<
        string,
        Array<{
          hooks?: Array<{ type?: string; command?: string; shell?: string }>;
          _mcManaged?: boolean;
        }>
      >;
    };
    const hook = settings.hooks.UserPromptSubmit?.[0]?.hooks?.[0];

    expect(hook).toMatchObject({
      type: "command",
      shell: "powershell",
    });
    expect(hook?.command).toContain("Invoke-WebRequest");
    expect(hook?.command).toContain("$env:MC_API_URL");
    expect(hook?.command).not.toContain("if [");
  });

  it("keeps non-Latin-1 payloads intact through the Windows PowerShell hooks", () => {
    const commandFor = windowsClaudeHookCommands();
    const askQuestion = commandFor("PreToolUse", "AskUserQuestion");
    const userPrompt = commandFor("UserPromptSubmit");
    expect(askQuestion).not.toBe("");
    expect(userPrompt).not.toBe("");

    // Windows PowerShell 5.1 decodes stdin with the console code page and sends
    // a string -Body as ISO-8859-1, so a Cyrillic AskUserQuestion reached the
    // overlay as "?????" (issue #130). Stdin must be read as UTF-8 bytes and the
    // body posted as bytes, which both 5.1 and pwsh send verbatim.
    for (const command of [askQuestion, userPrompt]) {
      expect(command).toContain(
        "[System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))",
      );
      expect(command).toContain("[System.Text.Encoding]::UTF8.GetBytes($payload)");
      expect(command).toContain("-Body $body");
      expect(command).toContain('-ContentType "application/json; charset=utf-8"');
      expect(command).not.toContain("[Console]::In.ReadToEnd()");
      expect(command).not.toContain("-Body $payload");
    }

    // injectContext events hand Claude the server's response bytes untouched
    // (no ISO-8859-1 decode + ConvertTo-Json round trip); status-only events
    // discard the response.
    expect(userPrompt).toContain("$r.RawContentStream.ToArray()");
    expect(userPrompt).toContain("[Console]::OpenStandardOutput()");
    expect(userPrompt).not.toContain("ConvertTo-Json");
    expect(userPrompt).not.toContain("Out-Null");
    expect(askQuestion).toContain("| Out-Null");
    expect(askQuestion).not.toContain("OpenStandardOutput");
  });

  // The substring assertions above can't tell a script that parses from one
  // that doesn't, so run the generated commands for real against a local server
  // and compare what crosses the wire in both directions.
  it.skipIf(POWERSHELLS.length === 0)(
    "round-trips UTF-8 through the generated PowerShell hooks when executed",
    async () => {
      const commandFor = windowsClaudeHookCommands();
      const payload = Buffer.from(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_input: { questions: [{ question: "Какой вариант выбрать? — 日本語 🚀" }] },
        }),
        "utf8",
      );
      const injected = Buffer.from(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: "Память проекта — 記憶 🧠",
          },
        }),
        "utf8",
      );

      const received: Array<{ url: URL; headers: http.IncomingHttpHeaders; body: string }> = [];
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          received.push({
            url: new URL(req.url ?? "", "http://127.0.0.1"),
            headers: req.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(injected);
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const env = {
        ...process.env,
        MC_TASK_ID: "task 1/a",
        MC_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        MC_API_TOKEN: "test-token",
      };

      try {
        for (const bin of POWERSHELLS) {
          received.length = 0;

          // Status-only event: the payload arrives intact, stdout stays empty.
          const ask = await runHook(bin, commandFor("PreToolUse", "AskUserQuestion"), payload, env);
          expect(ask.stderr, bin).toBe("");
          expect(ask.code, bin).toBe(0);
          expect(ask.stdout.toString("utf8"), bin).toBe("");

          // injectContext event: the response reaches stdout byte for byte.
          const prompt = await runHook(bin, commandFor("UserPromptSubmit"), payload, env);
          expect(prompt.stderr, bin).toBe("");
          expect(prompt.code, bin).toBe(0);
          expect(prompt.stdout.toString("utf8"), bin).toBe(injected.toString("utf8"));

          expect(received.map((r) => r.url.searchParams.get("hookEvent")), bin).toEqual([
            "PreToolUse",
            "UserPromptSubmit",
          ]);
          for (const request of received) {
            expect(request.url.pathname, bin).toBe("/api/hooks/claude");
            expect(request.url.searchParams.get("taskId"), bin).toBe("task 1/a");
            expect(request.headers.authorization, bin).toBe("Bearer test-token");
            expect(request.headers["content-type"], bin).toBe("application/json; charset=utf-8");
            expect(request.body, bin).toBe(payload.toString("utf8"));
          }
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    60_000,
  );

  // `catch {}` swallows the error but leaves `$?` false, which `-Command` turns
  // into exit code 1 — and Claude reports any non-zero hook exit as a hook
  // error. The POSIX hook ends in `|| true`; this one must exit 0 as well.
  it.skipIf(POWERSHELLS.length === 0)(
    "exits 0 and stays silent when Mission Control is unreachable",
    async () => {
      const commandFor = windowsClaudeHookCommands();
      const server = http.createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const env = {
        ...process.env,
        MC_TASK_ID: "task-1",
        MC_API_URL: `http://127.0.0.1:${port}`,
        MC_API_TOKEN: "test-token",
      };

      for (const bin of POWERSHELLS) {
        for (const command of [
          commandFor("PreToolUse", "AskUserQuestion"),
          commandFor("UserPromptSubmit"),
        ]) {
          const down = await runHook(bin, command, Buffer.from("{}", "utf8"), env);
          expect(down.stderr, bin).toBe("");
          expect(down.stdout.toString("utf8"), bin).toBe("");
          expect(down.code, bin).toBe(0);
        }
      }
    },
    60_000,
  );

  it("registers Codex lifecycle hooks in Codex's matcher-group format", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("codex", cwd);

    const raw = fs.readFileSync(path.join(cwd, ".codex", "hooks.json"), "utf8");
    const settings = JSON.parse(raw) as {
      hooks: Record<
        string,
        Array<{
          hooks?: Array<{ type?: string; command?: string }>;
          _mcManaged?: boolean;
        }>
      >;
    };

    expect(settings.hooks.UserPromptSubmit?.[0]).toMatchObject({
      _mcManaged: true,
      hooks: [
        {
          type: "command",
        },
      ],
    });
    expect(settings.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain(
      "/api/hooks/codex?taskId=$MC_TASK_ID&hookEvent=UserPromptSubmit"
    );
    expect(settings.hooks.Stop?.[0]?.hooks?.[0]?.command).toContain("hookEvent=Stop");
    expect(settings.hooks.PermissionRequest?.[0]?.hooks?.[0]?.command).toContain(
      "hookEvent=PermissionRequest"
    );
  });

  it("registers Cursor CLI hooks in Cursor's direct command format", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("cursor-cli", cwd);

    const raw = fs.readFileSync(path.join(cwd, ".cursor", "hooks.json"), "utf8");
    const settings = JSON.parse(raw) as {
      version?: number;
      hooks: Record<string, Array<{ command?: string; hooks?: unknown; _mcManaged?: boolean }>>;
    };

    expect(settings.version).toBe(1);
    expect(settings.hooks.beforeSubmitPrompt?.[0]).toMatchObject({
      _mcManaged: true,
    });
    expect(settings.hooks.beforeSubmitPrompt?.[0]?.command).toContain(
      "/api/hooks/cursor?taskId=$MC_TASK_ID&hookEvent=beforeSubmitPrompt"
    );
    expect(settings.hooks.beforeSubmitPrompt?.[0]?.command).toContain(
      '{"continue":true}'
    );
    expect(settings.hooks.beforeSubmitPrompt?.[0]?.command).toContain("--data-binary @-");
    expect(settings.hooks.beforeSubmitPrompt?.[0]?.hooks).toBeUndefined();
    expect(settings.hooks.sessionStart?.[0]?.command).toContain("hookEvent=sessionStart");
    expect(settings.hooks.stop?.[0]?.command).toContain("hookEvent=stop");
    expect(settings.hooks.afterAgentResponse?.[0]?.command).toContain(
      "hookEvent=afterAgentResponse"
    );
  });

  it("installs the OpenCode Mission Control plugin", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("opencode", cwd);

    const file = path.join(cwd, ".opencode", "plugins", "mission-control.js");
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("@mission-control-managed");
    expect(source).toContain("/api/hooks/opencode");
    expect(source).toContain("session.idle");
    expect(source).toContain("MissionControlStatus");
  });

  const readClaudePostToolUse = (cwd: string) => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(cwd, ".claude", "settings.local.json"), "utf8"),
    ) as {
      hooks: Record<
        string,
        Array<{ matcher?: string; hooks?: Array<{ command?: string }>; _mcManaged?: boolean }>
      >;
    };
    return settings.hooks.PostToolUse ?? [];
  };

  it("installs the pet mid-run PostToolUse hook when the pet is enabled", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("claude-code", cwd, undefined, { petEnabled: true });

    const groups = readClaudePostToolUse(cwd);
    // AskUserQuestion (status) group is preserved alongside the pet group.
    expect(groups.some((g) => g.matcher === "AskUserQuestion")).toBe(true);
    const pet = groups.find((g) => g.matcher === "Bash|Write|Edit");
    expect(pet?._mcManaged).toBe(true);
    const command = pet?.hooks?.[0]?.command ?? "";
    expect(command).toContain("hookEvent=PostToolUse");
    // No shell-side time gate: it would silently drop a meaningful result that
    // lands within a neutral edit's window. Throttling is server-side instead.
    expect(command).not.toContain("mc-tool-react");
  });

  it("omits the pet hook when the pet is disabled, keeping AskUserQuestion", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("claude-code", cwd, undefined, { petEnabled: false });

    const groups = readClaudePostToolUse(cwd);
    expect(groups.some((g) => g.matcher === "AskUserQuestion")).toBe(true);
    expect(groups.some((g) => g.matcher === "Bash|Write|Edit")).toBe(false);
    const raw = fs.readFileSync(path.join(cwd, ".claude", "settings.local.json"), "utf8");
    expect(raw).not.toContain("mc-tool-react");
  });

  it("strips a previously-installed pet hook when the pet is turned off", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));

    installAgentHooks("claude-code", cwd, undefined, { petEnabled: true });
    expect(readClaudePostToolUse(cwd).some((g) => g.matcher === "Bash|Write|Edit")).toBe(true);

    // Next spawn with the pet off rebuilds managed groups without it.
    installAgentHooks("claude-code", cwd, undefined, { petEnabled: false });
    const groups = readClaudePostToolUse(cwd);
    expect(groups.some((g) => g.matcher === "Bash|Write|Edit")).toBe(false);
    expect(groups.some((g) => g.matcher === "AskUserQuestion")).toBe(true);
  });
});
