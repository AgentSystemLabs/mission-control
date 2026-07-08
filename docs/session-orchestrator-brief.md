# Session Orchestrator — Brief

> Status: early thoughts, not a spec. A feature to add later.

## The idea

Today the session grid is human-driven: I launch each agent session, watch it,
answer its questions, and merge it myself. The **Session Orchestrator** turns
that same grid into a self-driving pool. One "orchestrator" session owns a fleet
of worktree-scoped agent sessions (the cells we already have), feeds them work,
keeps them unblocked, and merges finished work through a quality gate — so I go
from *operator* to *supervisor*.

## Why it fits Mission Control

We already have every primitive this needs; the orchestrator is mostly glue:

- **Session grid + cells** → the fleet of workers, already rendered and focusable.
- **Git worktrees + scoped sessions** → each task runs isolated on its own branch.
- **New-agent launcher** → the orchestrator uses it to spin up a cell and pick the model.
- **Git integration** → branch/merge/verify plumbing for the quality gate.

The new parts are: a task queue, the assignment/monitor loop, the merge gate, and
an orchestrator control surface (probably a special cell or a panel over the grid).

## How it works (the loop)

1. Give the orchestrator a **plan** — an ordered list of tasks.
2. It assigns the next task to an **idle cell** (worktree + agent session), setting
   model + effort for that task.
3. It **watches** each running cell: if a session goes idle, finishes, or asks a
   question, the orchestrator responds — answer if it can, escalate to me if it can't.
4. When every cell is busy and work remains, it **grows the pool** (new cell).
5. A finished task passes a **verify gate** before its branch merges; failures
   bounce back to the same cell to fix.
6. Repeat until the queue drains.

## Two modes

- **Drip (default):** persistent pool, one task at a time per cell. Best when tasks
  touch overlapping files or ordering matters — the orchestrator serializes safely.
- **Fan-out:** a file-disjoint plan launched all at once, one worktree per task.
  Best for wide, independent work; finishes in one wall-clock pass.

## The quality gate

No branch merges on trust. Each finished task runs the project's build/test, then a
second **reviewer** session (pinned to a fixed commit so the gate can't drift)
adversarially checks the diff. Only a clean pass merges; anything else is handed
back to the cell that produced it with the findings.

## Open questions

- Where does the orchestrator live — a reserved cell, a dedicated panel, or a mode toggle on the grid?
- What's the plan format, and can the orchestrator draft/split the plan itself vs. me writing it?
- How much can it auto-answer vs. escalate — and how are escalations surfaced without stealing focus?
- Merge target and conflict policy when several fan-out branches land close together.
- Per-task cost/limit controls, and a global stop that parks the whole fleet cleanly.
- Persistence/resume: reconnecting to a running fleet after the app restarts.
