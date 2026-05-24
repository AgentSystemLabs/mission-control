import { describe, expect, it } from "vitest";
import { agentPtyEnvOverrides, applyAgentPtyEnv } from "../agent-pty-env";

describe("applyAgentPtyEnv", () => {
  it("strips truecolor hints and disables incompatible OpenTUI probes for OpenCode", () => {
    const env = {
      COLORTERM: "truecolor",
      WT_SESSION: "abc",
      TERM: "xterm-256color",
    };
    applyAgentPtyEnv(env, "opencode");
    expect(env).toEqual({
      TERM: "xterm-256color",
      OPENTUI_FORCE_EXPLICIT_WIDTH: "0",
      OPENTUI_GRAPHICS: "0",
    });
  });

  it("does not override env for other agents", () => {
    const env = { COLORTERM: "truecolor", TERM: "xterm-256color" };
    applyAgentPtyEnv(env, "claude-code");
    expect(env).toEqual({ COLORTERM: "truecolor", TERM: "xterm-256color" });
  });
});

describe("agentPtyEnvOverrides", () => {
  it("returns remote-safe OpenCode overrides", () => {
    expect(agentPtyEnvOverrides("opencode")).toEqual({
      COLORTERM: "",
      OPENTUI_FORCE_EXPLICIT_WIDTH: "0",
      OPENTUI_GRAPHICS: "0",
    });
  });

  it("does not override env for other agents", () => {
    expect(agentPtyEnvOverrides("claude-code")).toEqual({});
    expect(agentPtyEnvOverrides(undefined)).toEqual({});
  });
});
