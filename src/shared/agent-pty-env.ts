/**
 * Agent-specific PTY environment overrides.
 *
 * OpenCode's OpenTUI stack uses two features that xterm.js (Mission Control's
 * terminal renderer) does not handle cleanly:
 *
 * 1. OSC 66 "explicit width" probing — garbles startup output until redraw.
 * 2. RGB / truecolor detection — enables the Logo component's sub-pixel block
 *    trick (rendering █ as ▀ with independent fg/bg colors per half-row). xterm
 *    draws those cells incorrectly, which produces the banded OPENCODE wordmark.
 *
 * Keep OpenCode on 256-color rendering inside Mission Control by stripping
 * truecolor hints and disabling the incompatible probes.
 */
export function applyAgentPtyEnv(
  env: Record<string, string>,
  agent: string | undefined,
): void {
  if (agent !== "opencode") return;

  // Inherited shells often export COLORTERM=truecolor; that flips OpenTUI's rgb
  // capability and activates the broken sub-pixel logo path.
  delete env.COLORTERM;
  delete env.WT_SESSION;

  Object.assign(env, {
    OPENTUI_FORCE_EXPLICIT_WIDTH: "0",
    OPENTUI_GRAPHICS: "0",
  });
}

/** Remote PTY env objects cannot delete inherited keys — blank them instead. */
export function agentPtyEnvOverrides(agent: string | undefined): Record<string, string> {
  if (agent !== "opencode") return {};
  return {
    COLORTERM: "",
    OPENTUI_FORCE_EXPLICIT_WIDTH: "0",
    OPENTUI_GRAPHICS: "0",
  };
}
