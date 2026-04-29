# Agent status detection

How Mission Control knows whether an agent terminal is **working**, **idle**,
or **waiting on a human**.

## Standard mechanism: Claude Code hooks

Claude Code emits lifecycle hooks we can subscribe to from outside the
process. We register hooks per project so each task reports its own state.

A new task starts in `ready` (terminal spawned, prompt waiting). The first
hook flips it.

| Hook event                         | Mapped status   | Meaning                                  |
| ---------------------------------- | --------------- | ---------------------------------------- |
| _(spawn)_                          | `ready`         | Terminal up, user hasn't typed yet       |
| `UserPromptSubmit`                 | `running`       | User just submitted a prompt; work began |
| `Stop`                             | `finished`      | Claude finished its turn                 |
| `PermissionRequest`                | `needs-input`   | Permission / tool approval requested     |
| `Notification` `permission_prompt` | `needs-input`   | Permission prompt notification fallback  |

`SubagentStop` is intentionally ignored. It means a child agent finished, not
that the top-level Claude turn is done. A top-level `Stop` follows when the
whole turn is actually finished.

`Notification` is also intentionally narrowed to `permission_prompt`. Claude
Code also sends idle input reminders through the same hook event, so treating
all notifications as `needs-input` creates false positives that later flip to
`finished` when the real `Stop` event arrives.

There is **no need for a custom MCP server** — hooks are the supported
primitive for this. MCP would add work without giving us anything new.

## Wiring

When the renderer spawns a `claude-code` task it:

1. Resolves the local API URL (`http://127.0.0.1:<runtimePort>`) and the
   bearer token from `/api/settings`.
2. Passes them as `mcEnv` plus `agent: "claude-code"` to `pty:spawn`.

The Electron main process (`electron/pty-manager.ts`):

1. Calls `installClaudeHooks(cwd)` (`electron/claude-hooks.ts`), which writes
   or merges entries into `<cwd>/.claude/settings.local.json`. Existing user
   hooks are preserved; ours are tagged with `_mcManaged: true` so they can
   be replaced cleanly on the next spawn.
2. Injects `MC_TASK_ID`, `MC_API_URL`, `MC_API_TOKEN` into the PTY env.

Each managed hook entry runs:

```sh
sh -c 'curl -sS -m 3 -X POST \
  -H "Authorization: Bearer $MC_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$MC_API_URL/api/hooks/claude?taskId=$MC_TASK_ID"'
```

Claude pipes the hook payload (`hook_event_name`, `session_id`, `cwd`,
`transcript_path`, …) on stdin; we forward it as the request body. The
endpoint `POST /api/hooks/claude?taskId=<id>` (`src/server/api-router.ts`)
maps the hook payload to a `TaskStatus` and calls `updateStatus`, which emits
the existing event bus so the UI updates live. The endpoint also filters old
or broad `Notification` hooks defensively, so already-running terminals do not
turn idle reminders into `needs-input`.

The hook is fail-soft (`|| true`) — if Mission Control is down or the
endpoint is slow it never blocks the user's session.

## Other agents

`codex`, `cursor-cli`, and `shell` don't have an equivalent hook surface.
For those we still rely on PTY output heuristics (idle detection by
inactivity) and explicit user actions. The hook path is opt-in by agent
type (`opts.agent === "claude-code"`).

## What about a custom MCP?

We considered exposing a `mc-status` MCP server with a `set_status` tool
the agent could call. It works, but:

- It depends on the model voluntarily calling the tool, which is unreliable
  for *finished* and *needs-input* states (the model isn't running when
  it's waiting on you).
- Hooks already cover all three states deterministically, from outside the
  model loop.

If we ever need agent-driven state (e.g. "I'm running tests, ETA 2 min"),
that's the case where an MCP tool would add value — but that's
**additive** to hooks, not a replacement.
