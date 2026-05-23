import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  OPENCODE_MISSION_CONTROL_PLUGIN_MARKER,
  opencodeMissionControlPluginPath,
  opencodeMissionControlPluginSource,
  writeOpencodeMissionControlPlugin,
} from "../opencode-mission-control-plugin";

describe("opencode mission control plugin", () => {
  it("posts lifecycle hooks to the OpenCode hooks endpoint", () => {
    const source = opencodeMissionControlPluginSource();
    expect(source).toContain(OPENCODE_MISSION_CONTROL_PLUGIN_MARKER);
    expect(source).toContain("/api/hooks/opencode");
    expect(source).toContain("session.status");
    expect(source).toContain("session.idle");
    expect(source).toContain('postMissionControlHook("Stop"');
    expect(source).toContain('postMissionControlHook("UserPromptSubmit"');
    expect(source).toContain('postMissionControlHook("SessionStart"');
    expect(source).toContain('"PermissionRequest"');
    expect(source).toContain("MC_TASK_ID");
    expect(source).toContain('"shell.env"');
    expect(source).toContain('"chat.message"');
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain("question.asked");
    expect(source).toContain('"QuestionRequest"');
    expect(source).toContain("electron-local");
    expect(source).toContain("export const MissionControlStatus");
  });

  it("writes the managed plugin into .opencode/plugins", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-plugin-"));
    writeOpencodeMissionControlPlugin(cwd);

    const file = opencodeMissionControlPluginPath(cwd);
    expect(fs.existsSync(file)).toBe(true);
    const contents = fs.readFileSync(file, "utf8");
    expect(contents).toContain(OPENCODE_MISSION_CONTROL_PLUGIN_MARKER);
    expect(contents).toContain("MissionControlStatus");
  });
});
