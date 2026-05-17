# [CRITICAL] `POST /api/launch-kit/projects` extracts a tarball + runs `git init` at a caller-chosen directory, unauthenticated

**Files:** `src/server/api-router.ts:431-444`, `src/server/services/launch-kit.ts:113-213`
**Category:** Auth bypass + arbitrary-directory write + spawn
**Severity:** Critical

## What's wrong

The route is anonymous. The body has `parentDir` and `projectName`. The implementation:

1. Verifies `parentDir` is an existing directory and `projectName` has no `..` / path separators (good).
2. Resolves `target = path.join(parentDir, projectName)` — but `parentDir` itself is unrestricted; it can be any writable directory.
3. Extracts a launch-kit tarball into `target`.
4. Runs `spawnSync("git", ["init"], { cwd: target })` (`launch-kit.ts:188`).

## Why fixing this is important — what could go wrong

Combined with finding 01, a malicious page POSTs:

```json
{ "parentDir": "/Users/victim/Library/LaunchAgents", "projectName": "x" }
```

…or any other auto-loaded directory the OS scans on login / login items / cron-loaded paths / IDE workspaces / `~/.zshrc.d/`. The launch-kit tarball ends up extracted at a path of the attacker's choosing. The attacker doesn't need to forge the tarball — they just need to choose *where* a legitimate tarball lands. Even a benign tarball that drops a `setup.sh` becomes a problem when it lands in a directory the system auto-runs.

`git init` running in that target is also a write the user didn't ask for, and may shadow or break existing repo state.

## How to fix it

1. Require auth on the route (`src/server/api-router.ts:431`).
2. Restrict `parentDir` to an explicit allow-list. The natural source is the user's configured "projects root" from settings, or an explicitly user-confirmed parent directory passed via Electron IPC (which goes through the OS dialog, not an HTTP body).
3. Reject `parentDir` values resolving to any of: `~`, `~/Library/`, `~/.config/`, `~/.local/`, `/Applications/`, `/usr/`, `/etc/`, `/System/`, `/Library/`, Windows equivalents.
4. After `git init` succeeds, return the resolved path so the renderer can surface it to the user (defense-in-depth — gives the user a chance to spot an unexpected destination).
