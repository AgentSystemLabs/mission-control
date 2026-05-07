# Agent status detection

How Mission Control knows whether an agent terminal is **working**, **idle**,
or **waiting on a human**.

## Standard mechanism: agent lifecycle hooks

Claude Code and Codex emit lifecycle hooks we can subscribe to from outside the
process. We register hooks per project so each task reports its own state.

A new task starts in `ready` (terminal spawned, prompt waiting). The first
hook flips it.

| Hook event                         | Mapped status   | Meaning                                  |
| ---------------------------------- | --------------- | ---------------------------------------- |
| _(spawn)_                          | `ready`         | Terminal up, user hasn't typed yet       |
| `UserPromptSubmit`                 | `running`       | User just submitted a prompt; work began |
| `Stop`                             | `finished`      | Agent finished its turn                  |
| `PermissionRequest`                | `needs-input`   | Permission / tool approval requested     |
| `Notification` `permission_prompt` | `needs-input`   | Claude permission notification fallback  |

`SubagentStop` is intentionally ignored. It means a child agent finished, not
that the top-level Claude turn is done. A top-level `Stop` follows when the
whole turn is actually finished.

`Notification` is also intentionally narrowed to `permission_prompt`. Claude
Code also sends idle input reminders through the same hook event, so treating
all notifications as `needs-input` creates false positives that later flip to
`finished` when the real `Stop` event arrives.

## Wiring

When the renderer spawns a hook-capable task it:

1. Resolves the local API URL (`http://127.0.0.1:<runtimePort>`) and the
   bearer token from `/api/settings`.
2. Passes them as `mcEnv` plus the agent type to `pty:spawn`.

The Electron main process (`electron/pty-manager.ts`) calls
`installAgentHooks(agent, cwd)` (`electron/agent-hooks.ts`), which uses a small
per-agent hook registry:

1. Claude Code writes or merges entries into
   `<cwd>/.claude/settings.local.json`.
2. Codex writes or merges entries into `<cwd>/.codex/hooks.json`.
3. Existing user hooks are preserved; ours are tagged with `_mcManaged: true`
   so they can be replaced cleanly on the next spawn.
4. The PTY gets `MC_TASK_ID`, `MC_API_URL`, `MC_API_TOKEN` in its env.

Each managed Claude hook entry runs:

```sh
sh -c 'curl -sS -m 3 -X POST \
  -H "Authorization: Bearer $MC_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$MC_API_URL/api/hooks/claude?taskId=$MC_TASK_ID"'
```

Each managed Codex hook entry is the same shape, but posts to
`$MC_API_URL/api/hooks/codex?taskId=$MC_TASK_ID`. Codex is launched with
`--enable codex_hooks` so project-local hooks are active for the session.

The agent pipes the hook payload (`hook_event_name`, `session_id`, `cwd`,
`transcript_path`, …) on stdin; we forward it as the request body. The
endpoint `POST /api/hooks/<agent-slug>?taskId=<id>` (`src/server/api-router.ts`)
maps the hook payload to a `TaskStatus` and calls `updateStatus`, which emits
the existing event bus so the UI updates live. The endpoint also filters old
or broad `Notification` hooks defensively, so already-running terminals do not
turn idle reminders into `needs-input`.

The hook is fail-soft (`|| true`) — if Mission Control is down or the
endpoint is slow it never blocks the user's session.

## Interrupt fallback

Claude does not expose `UserInterrupt` as a settings hook event. When a user
presses Esc during a Claude turn, the Electron PTY manager scans output for
Claude's interrupt prompt (`Interrupted ... What should Claude do instead?`)
and posts an internal synthetic `UserInterrupt` payload to the same local hook
endpoint. The server maps that synthetic event to `interrupted` because Claude
is waiting for revised instructions after an explicit user interruption.

## Other agents

`cursor-cli` and `shell` don't have an equivalent hook surface. For those we
mark the task `running` when the user submits a line in the terminal. More
specific states still require explicit status updates. The hook path is opt-in
by agent type.

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
