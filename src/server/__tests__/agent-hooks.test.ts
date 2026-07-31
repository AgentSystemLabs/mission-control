import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installAgentHooks } from "../../../electron/agent-hooks";

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
    expect(hook?.command).toContain("Invoke-RestMethod");
    expect(hook?.command).toContain("$env:MC_API_URL");
    expect(hook?.command).not.toContain("if [");
  });

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
      "/api/hooks/codex?taskId=${MC_TASK_ID:-}&hookEvent=UserPromptSubmit"
    );
    expect(settings.hooks.Stop?.[0]?.hooks?.[0]?.command).toContain("hookEvent=Stop");
    expect(settings.hooks.PermissionRequest?.[0]?.hooks?.[0]?.command).toContain(
      "hookEvent=PermissionRequest"
    );
  });

  it("registers native Grok Build hooks without enabling Claude compatibility", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));
    const grokHome = path.join(cwd, "grok-home");
    const claudeFile = path.join(cwd, ".claude", "settings.local.json");

    installAgentHooks("grok", cwd, undefined, { grokHome });

    const file = path.join(grokHome, "hooks", "mission-control.json");
    const settings = JSON.parse(fs.readFileSync(file, "utf8")) as {
      hooks: Record<
        string,
        Array<{
          matcher?: string;
          hooks?: Array<{ type?: string; command?: string }>;
          _mcManaged?: boolean;
        }>
      >;
    };

    expect(fs.existsSync(claudeFile)).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".grok"))).toBe(false);
    expect(settings.hooks.UserPromptSubmit?.[0]).toMatchObject({
      _mcManaged: true,
      hooks: [{ type: "command" }],
    });
    expect(settings.hooks.Notification?.[0]?.matcher).toBe("permission_prompt");
    expect(settings.hooks.PreToolUse?.[0]?.matcher).toBe("ask_user_question");
    expect(settings.hooks.PostToolUse?.[0]?.matcher).toBe("ask_user_question");
    expect(settings.hooks.SubagentStart?.[0]?._mcManaged).toBe(true);
    expect(settings.hooks.SubagentStop?.[0]?._mcManaged).toBe(true);
    expect(settings.hooks.StopFailure?.[0]?._mcManaged).toBe(true);
    expect(settings.hooks.SessionEnd?.[0]?._mcManaged).toBe(true);

    const command = settings.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command ?? "";
    expect(command).toContain("/api/hooks/grok");
    expect(command).toContain("${MC_TASK_ID:-}");
    expect(command).toContain("${MC_API_URL:-}");
    expect(command).toContain("${MC_API_TOKEN:-}");
  });

  it("leaves Grok user config and sibling native hook files byte-for-byte intact", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));
    const grokHome = path.join(cwd, "grok-home");
    const hooksDir = path.join(grokHome, "hooks");
    const siblingHook = path.join(hooksDir, "cmux-session.json");
    const configFile = path.join(grokHome, "config.toml");
    const siblingContents =
      '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"cmux hooks grok stop"}]}]}}\n';
    const configContents = "[compat.claude]\nhooks = false\n";
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(siblingHook, siblingContents, "utf8");
    fs.writeFileSync(configFile, configContents, "utf8");

    installAgentHooks("grok", cwd, undefined, { grokHome });

    expect(fs.readFileSync(siblingHook, "utf8")).toBe(siblingContents);
    expect(fs.readFileSync(configFile, "utf8")).toBe(configContents);
  });

  it("resolves a relative GROK_HOME against the session working directory", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grok-relative-home-"));

    installAgentHooks("grok", cwd, undefined, { grokHome: "state/grok" });

    expect(
      fs.existsSync(
        path.join(cwd, "state", "grok", "hooks", "mission-control.json"),
      ),
    ).toBe(true);
  });

  it("uses an owned PowerShell bridge for native Grok hooks on Windows", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));
    const grokHome = path.join(cwd, "Grok Build Home");

    installAgentHooks("grok", cwd, "win32", { grokHome });

    const hooksDir = path.join(grokHome, "hooks");
    const settings = JSON.parse(
      fs.readFileSync(path.join(hooksDir, "mission-control.json"), "utf8"),
    ) as {
      hooks: Record<
        string,
        Array<{ hooks?: Array<{ command?: string; shell?: string }> }>
      >;
    };
    const command = settings.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command ?? "";
    const bridge = fs.readFileSync(
      path.join(hooksDir, "mission-control-hook.ps1"),
      "utf8",
    );

    expect(command).toContain("powershell.exe");
    expect(command).toContain("-File");
    expect(command).toContain("mission-control-hook.ps1");
    expect(command).toContain("grok UserPromptSubmit");
    expect(command).not.toContain("$env:");
    expect(command).not.toContain("MC_TASK_ID");
    expect(settings.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.shell).toBeUndefined();

    expect(bridge).toContain("$env:MC_TASK_ID");
    expect(bridge).toContain("$env:MC_API_URL");
    expect(bridge).toContain("$env:MC_API_TOKEN");
    expect(bridge).toContain("/api/hooks/");
    expect(bridge).toContain("Invoke-RestMethod");
    expect(bridge).toContain("Out-Null");
  });

  it("preserves user-authored native Grok Build hooks across reinstalls", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hooks-"));
    const grokHome = path.join(cwd, "grok-home");
    const file = path.join(grokHome, "hooks", "mission-control.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "bin/user-stop-hook" }] }],
        },
      }),
      "utf8",
    );

    installAgentHooks("grok", cwd, undefined, { grokHome });
    installAgentHooks("grok", cwd, undefined, { grokHome });

    const settings = JSON.parse(fs.readFileSync(file, "utf8")) as {
      hooks: Record<
        string,
        Array<{ hooks?: Array<{ command?: string }>; _mcManaged?: boolean }>
      >;
    };
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop?.[0]?.hooks?.[0]?.command).toBe("bin/user-stop-hook");
    expect(settings.hooks.Stop?.[1]?._mcManaged).toBe(true);
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
      "/api/hooks/cursor?taskId=${MC_TASK_ID:-}&hookEvent=beforeSubmitPrompt"
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
