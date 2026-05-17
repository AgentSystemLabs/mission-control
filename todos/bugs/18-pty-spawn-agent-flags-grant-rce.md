# [HIGH] `pty:spawn` agent allow-list ends at the binary; agent CLI flags still grant code execution

**Files:** `electron/pty-spawn-policy.ts:8-13` (`AGENT_BINARIES`), `electron/pty-spawn-policy.ts:170-204` (agent branch)
**Category:** Incomplete allow-list / RCE-via-trusted-binary
**Severity:** High
**Surfaced by:** reviewer-security-regression on bug 05 fix (2026-05-16)

## What's wrong

The bug-05 fix allow-lists *which binary* the agent branch may spawn (`claude`, `codex`, `cursor-agent`) and tokenizes `command` into argv. But `args` is then passed through with only a shell-metacharacter regex check (no `=`, no `--flag` filter). Several of the allow-listed binaries themselves accept flags that load attacker-controlled config or run attacker-controlled commands, so the "agent-with-clean-argv" boundary is not equivalent to "no code execution":

- `claude --mcp-config <path>` reads a JSON file that can declare `command`/`args` for an MCP stdio server — full code execution.
- `claude --dangerously-skip-permissions` removes the permission gate around tool calls; combined with a piped prompt this is effectively unattended RCE.
- `codex --enable hooks` + a planted `.codex/hooks.json` (see bug 11) auto-executes shell commands on prompt events.
- `cursor-agent` similarly honors config files in `.cursor/` for hook commands.

The policy module documents itself as preventing "an RCE primitive", but the prevention is narrower than the comment suggests — it stops a renderer from spawning `bash`, `curl`, `sh`, etc., but does not stop a renderer from passing `--mcp-config /tmp/attacker.json` to a trusted agent.

## Why fixing this is important — what could go wrong

A briefly-compromised renderer (finding 04 scenario) still gets code execution by calling:

```js
window.electronAPI.pty.spawn({
  taskId: "x",
  cwd: "/Users/me/code/some-registered-project",
  command: "claude",
  args: ["--mcp-config", "/tmp/evil.json"],
  agent: "claude-code",
});
```

…where `/tmp/evil.json` was written earlier (via finding 11's `files:write` surface, or any other write primitive). Bug 05's policy accepts this request because:

- `command` first token is `"claude"` (on the allow-list).
- `args` contains no shell metacharacters.
- `cwd` is a registered project root.
- `agent` is in the allow-list.

The argv hits `pty.spawn("claude", ["--mcp-config", "/tmp/evil.json"], …)` and Claude Code runs the MCP server, which runs the attacker's command.

## How to fix it

Layer a per-agent flag allow-list onto the binary allow-list. Two reasonable shapes:

1. **Whitelist the flags we actually call.** Mission Control only ever passes `--session-id <uuid>`, `--resume <uuid>`, `--bare`, `--dangerously-skip-permissions`, `--force`, `--enable hooks`, `--yolo`. Anything else is rejected. This is restrictive but covers every current call site (see `src/lib/claude-command.ts` + `src/shared/agents.ts:AGENT_REGISTRY`).
2. **Blacklist the known-dangerous flags per agent.** Reject `--mcp-config`, `--mcp-server`, anything matching `--*-config` (path-loaded config), and `--dangerously-skip-permissions` unless the renderer also opted into a `dangerouslySkipPermissions: true` flag on the IPC call (which agent terminals would then thread through deliberately).

The whitelist approach is the higher-trust choice and aligns with how `pty-spawn-policy.ts` already gates the binary. A `PER_AGENT_FLAG_ALLOWLIST` table next to `AGENT_BINARIES` is the natural home.

For both shapes, add fuzz-style regression tests asserting that `--mcp-config`, `--mcp-server`, `--config-file`, etc. are rejected for each agent.

## Notes

- The bug-05 fix is still a substantial improvement — without it, the renderer could spawn `curl | sh` directly. This finding is the next layer.
- Bug 11 (`install-agent-hooks-cwd-not-validated`) is partly mitigated by bug 05's `plan.cwd` canonicalization, but the hook files themselves can still be planted via other write surfaces — addressing this bug closes the "load an attacker config" half of the attack.
