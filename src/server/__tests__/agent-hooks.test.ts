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

    // SessionStart drives the code-graph auto-index.
    const sessionStart = settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command;
    expect(sessionStart).toContain("hookEvent=SessionStart");

    // UserPromptSubmit keeps stdout (the injected recall block); Stop discards it.
    const userPrompt = settings.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command ?? "";
    expect(userPrompt).toContain("hookEvent=UserPromptSubmit");
    expect(userPrompt).not.toContain(">/dev/null 2>&1");
    expect(userPrompt).toContain("2>/dev/null || true");

    const stop = settings.hooks.Stop?.[0]?.hooks?.[0]?.command ?? "";
    expect(stop).toContain(">/dev/null 2>&1 || true");
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
});
