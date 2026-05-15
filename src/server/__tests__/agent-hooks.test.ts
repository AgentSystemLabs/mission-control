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
      "{\"continue\":true}"
    );
    expect(settings.hooks.beforeSubmitPrompt?.[0]?.hooks).toBeUndefined();
    expect(settings.hooks.stop?.[0]?.command).toContain("hookEvent=stop");
    expect(settings.hooks.afterAgentResponse?.[0]?.command).toContain(
      "hookEvent=afterAgentResponse"
    );
  });
});
