# [HIGH] `installAgentHooks` writes shell-executing config to a renderer-supplied `cwd`

**Files:** `electron/pty-manager.ts:270`, `electron/agent-hooks.ts:168-217`
**Category:** Path-controlled write of auto-executed config
**Severity:** High

## What's wrong

When `pty:spawn` is called with `agent: "claude-code" | "codex" | "cursor-cli"`, `installAgentHooks` writes:

- `<cwd>/.claude/settings.local.json`
- `<cwd>/.codex/hooks.json`
- `<cwd>/.cursor/hooks.json`

…all containing shell commands that the respective agent will run on every prompt submit, stop, and permission request. The `cwd` is renderer-supplied with no validation that it points at a known project.

The command *text* inside the written config is fixed (no renderer-controlled string interpolation), and shell-quoting around `$MC_TASK_ID` / `$MC_API_URL` is correct — so this isn't a string-injection bug. The injection is **positional**: the attacker chooses *where* the file lands.

## Why fixing this is important — what could go wrong

A compromised renderer can clobber the user's existing agent config in any directory:

```js
window.electronAPI.pty.spawn({
  taskId,
  cwd: "/Users/victim",          // not a project — but accepted
  command: "true",
  agent: "claude-code",
});
```

Result: `/Users/victim/.claude/settings.local.json` is overwritten — silently breaking or replacing the user's home-dir Claude config. Combined with finding 10 (renderer-controlled `mcEnv.apiUrl`), the planted hook config can also be wired to POST to an attacker URL with the user's bearer token.

## How to fix it

1. Validate `cwd` against the set of registered project roots (`src/server/services/projects.ts → listProjects()`). Reject any `cwd` not present.
2. This is the same fix recommended for finding 05's `pty:spawn` `cwd` — implement it once at the top of the handler and both findings are addressed.
3. After landing finding 10, also validate that the `mcEnv.apiUrl` baked into the hook command body is the legitimate runtime origin (since the hook writes `apiUrl` into the on-disk config).
