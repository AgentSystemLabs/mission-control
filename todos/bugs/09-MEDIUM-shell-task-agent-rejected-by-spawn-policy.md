# [MEDIUM] `TaskAgent` includes `"shell"` but `pty:spawn` rejects it — domain enum wider than the runtime allow-list

**Files:** `src/shared/domain.ts:1` (`TASK_AGENTS`), `src/shared/agents.ts:57-66` (`AGENT_REGISTRY.shell`), `electron/pty-spawn-policy.ts:8-13` (`AGENT_BINARIES`)
**Category:** Contract drift (domain model vs. runtime allow-list)
**Severity:** Medium
**Surfaced by:** reviewer-contracts on bug 05 fix (2026-05-16)

## What's wrong

`TASK_AGENTS = ["claude-code", "codex", "cursor-cli", "shell"]` claims `"shell"` is a valid agent slug. `AGENT_REGISTRY.shell` exists (`uiVisible: false`, `command: "$SHELL"`, `startCommand: () => ""`). But `AGENT_BINARIES` in the new spawn policy only knows three:

```ts
export const AGENT_BINARIES: Readonly<Record<TaskAgentSpawn, string>> = {
  "claude-code": "claude",
  "codex":       "codex",
  "cursor-cli":  "cursor-agent",
};
```

If a task ever lands with `agent: "shell"` and the renderer calls `pty.spawn({ agent: "shell", ... })`, the policy rejects it with `unknown-agent`.

In practice this is unreachable today: `UI_AGENTS` filters by `uiVisible: true`, and `NewAgentDialog.tsx` only offers `UI_AGENTS`. There is no current path that creates a task with `agent: "shell"`. But the type allows it — and the spawn-side and contract-side disagree on the domain.

## Why fixing this is important — what could go wrong

- A future PR that re-enables a "shell task" experience would discover the rejection at runtime, in the renderer, after the task has already been persisted.
- It's a small but real piece of dead code that hints at a feature that doesn't actually work. New contributors reading `AGENT_REGISTRY.shell` will reasonably assume shell tasks exist.
- The `Task.agent: TaskAgent` column in SQLite (`src/db/schema.ts:66`) accepts `"shell"`, so a manual DB edit (or a future feature that flips `uiVisible: true`) lands on the bug immediately.

## How to fix it

Pick one of two directions:

1. **Drop the dead enum value.** Remove `"shell"` from `TASK_AGENTS` and `AGENT_REGISTRY`. Audit anything that referenced it (`design-meta.ts:10` has a `shell:` color entry, `cli-availability.ts` filters by `UI_AGENTS` so is unaffected). This is the lower-risk path — the feature does not exist and removing it tightens the type system.

2. **Wire `"shell"` through to the user-shell terminal path.** Have `TerminalPane.tsx` translate `task.agent === "shell"` into a spawn call with `{ shell: true, agent: undefined, command: "" }` rather than passing `agent: "shell"`. The policy already supports that branch via `shell: true`. Also add `"shell"` to the policy's known list and route it to the shell branch internally, so direct callers also work. This is the higher-effort path that resurrects the latent feature.

The bug-05 fix deliberately did not route option 2 inline because that would silently expand the bug-05 scope from "fix the RCE" to "design the shell-task UX." Either direction is fine — but the current state (type allows, runtime rejects) is the worst combination.
