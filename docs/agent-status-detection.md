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
| `Stop`                             | `finished`\*    | Foreground turn ended (see below)        |
| `SubagentStart` / `SubagentStop`   | _(bookkeeping)_ | Tracks still-active subagents            |
| `PermissionRequest`                | `needs-input`   | Permission / tool approval requested     |
| `Notification` `permission_prompt` | `needs-input`   | Claude permission notification fallback  |

\* `Stop` fires when the **foreground** turn ends — including while background
subagents (Task tool agents) the turn launched are still running. Treating it
as `finished` unconditionally dinged the user mid-work. So the server counts
`SubagentStart`/`SubagentStop` per task (`src/server/services/subagent-activity.ts`,
paired by the payload's `agent_id`, whose `session_id` is the parent session's)
and downgrades a `Stop` to `running` while any subagent is still active. A
background subagent's completion re-invokes the main agent, and *that* turn's
`Stop` — arriving with no active subagents left — lands as the real `finished`.
Neither subagent event maps to a status on its own, but one arriving **moments
after** a task finished heals it back to `running` (a `Stop` won the race
against the turn's own subagent lifecycle POST).

That heal is scoped to a 30-second recent-finish window because Claude Code
also runs **post-turn internal helpers** whose subagent events carry the
parent session id: refocusing a finished session generates an *away summary*,
firing `SubagentStart`/`SubagentStop` minutes after the finish, with no `Stop`
to follow. Healing on those wedges tasks on `running` forever (the original
stuck-on-running bug). Beyond the window, helper events are ignored for status
and their starts are not tracked — a lost helper stop would otherwise hold the
next turn's `Stop` for the whole TTL.

Backstops, so a `SubagentStop` that never arrives (lost POST, killed process)
— or a healed `running` that no `Stop` will ever follow — cannot hold a task
on `running` forever:

- Tracked entries expire after 2 hours (kept long on purpose — a short TTL
  would prematurely finish sessions whose subagents legitimately run long).
- A held `Stop` (and a recent-finish heal) arms a once-a-minute recheck. Once
  the tracked set is idle — drained by real `SubagentStop`s or by expiry — a
  3-minute drain grace starts: if the re-invoked main agent's own `Stop` lands
  the finish within it (the normal flow), the backstop's promotion is a no-op
  (it only fires on tasks still `running`); if nothing follows, the backstop
  promotes to `finished`. New subagent activity resets the grace; a new
  `UserPromptSubmit` disarms it.
- Tracking is dropped outright when a new session id is captured, on
  `SessionStart` with `source: "clear"` (same session id, but `/clear` kills
  background work), and when the task goes `terminated` / `disconnected`.

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
`--enable hooks` so project-local hooks are active for the session.

The agent pipes the hook payload (`hook_event_name`, `session_id`, `cwd`,
`transcript_path`, …) on stdin; we forward it as the request body. The
endpoint `POST /api/hooks/<agent-slug>?taskId=<id>` (`src/server/api-router.ts`)
maps the hook payload to a `TaskStatus` and calls `updateStatus`, which emits
the existing event bus so the UI updates live. The endpoint also filters old
or broad `Notification` hooks defensively, so already-running terminals do not
turn idle reminders into `needs-input`.

The hook is fail-soft (`|| true`) — if Mission Control is down or the
endpoint is slow it never blocks the user's session.

## Dead-process fallbacks

Hooks only fire while the agent process lives, so two out-of-band signals
settle tasks whose process is gone:

- **PTY exit** — `electron/pty-manager.ts` posts a synthetic
  `MissionControlSessionEnded` event (with the exit code) whenever a session's
  PTY process exits, for any reason: the user closed the pane, a scope switch
  closed the project's sessions, the process crashed, or it was killed. The
  renderer's own exit handler only runs while the pane is mounted — and skips
  intentional closes entirely — so this is the reliable path. The server moves
  tasks still in an **active** status (`running` / `needs-input`) to `finished`
  (exit 0) or `terminated`, drops their tracked subagents, and leaves settled
  tasks untouched, which keeps respawn flows and finished sessions unaffected.
- **Boot sweep** — Electron main calls `POST /api/tasks/sweep-disconnected`
  once per app boot, before the first window loads. At that moment no local
  PTYs exist, so any local-scope task still `running` / `needs-input` is an
  orphan of the previous run (app quit or crash outran the exit event) and is
  marked `disconnected`. Sandbox-scoped tasks are excluded — their sessions
  run remotely and survive app restarts. The sweep deliberately does NOT run
  at server boot: in dev the API server (Vite) can restart while Electron's
  PTYs live on, and on macOS `activate` re-runs window creation while this
  run's PTYs are alive.

## Interrupt fallback

Claude does not expose `UserInterrupt` as a settings hook event. When a user
presses Esc during a Claude turn, the Electron PTY manager scans output for
Claude's interrupt prompt (`Interrupted ... What should Claude do instead?`)
and posts an internal synthetic `UserInterrupt` payload to the same local hook
endpoint. The server maps that synthetic event to `interrupted` because Claude
is waiting for revised instructions after an explicit user interruption.

## Other agents

`shell` doesn't have an equivalent hook surface, so it relies on explicit status
updates. Mission Control installs Cursor's `.cursor/hooks.json` entries for
`beforeSubmitPrompt`, `stop`, and `afterAgentResponse`. Cursor CLI requires
`"version": 1` in `.cursor/hooks.json`; without it, the CLI silently ignores the
file.

## Codex Hook Review

Codex may refuse to run newly installed project hooks until the user reviews
them with `/hooks`. When that prompt appears, the Electron PTY manager posts a
synthetic `PermissionRequest` to the Codex hook endpoint so the task moves to
`needs-input` instead of staying `running`. Once the user approves the Mission
Control hooks, Codex's real `UserPromptSubmit` and `Stop` hooks drive status.

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
