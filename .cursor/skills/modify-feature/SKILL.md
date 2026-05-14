---
name: modify-feature
metadata:
  audience: user
description: Modify an existing feature — add to it, change how it works, or wire a small new behavior into something that already exists. Use when the user says "modify", "modify this", "modify the X", "enhance", "extend", "add to existing X", "also do Y when Z", "make this also do…", "derive this from that", "add a new component/picker/widget that reads existing data", or proposes a tweak to a feature that already lives in the app. Lighter than add-feature (no full plan-approval gate), but still maps which contracts shift before editing so a small-feeling change doesn't silently break adjacent code. Includes conditional logic-first tests and integration-first observability for risky extensions. Accepts `mode=fast|balanced|production` to control depth (default: balanced); also accepts `include=` / `skip=` overrides. Skip for greenfield features (use add-feature), pure refactors, enum/state renames (use realign), and bug fixes (use fix-bug).
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Modify Feature

A small extension is the most dangerous size of change: large enough to shift requirements and adjacent contracts, small enough that the agent skips the thinking a full feature would trigger. The user's proposed shape is one option, not the spec.

---

## Modes

This skill accepts a `mode=` argument. Default — when no `mode=` is specified — is `balanced`: the four-question pre-flight + contract audit below.

| Mode | Behavior |
|---|---|
| `fast` | Skip the four pre-flight questions. Implement the user's literal proposal. Use only when the user has explicitly locked the seam (e.g. `mode=fast` in their prompt) and the change is genuinely single-file. |
| `balanced` (default) | The full pre-flight: alternative seam, contract audit, scope check, edge cases. Then edit, verify, and run gated post-checks for contracts, concurrency, observability, and tests when triggered. |
| `production` | `balanced` + an explicit scope-confirm gate before editing if the Q2 contract audit surfaces 5+ affected sites, plus mandatory tests for logic/data/API changes and observability instrumentation for integration boundaries. Pause and ask via `AskUserQuestion` whether to proceed as an extension or escalate to `add-feature` / `realign`. |

**`include=` / `skip=` overrides.** Add or remove specific concerns on top of the mode default — `mode=fast include=q2` runs the contract audit even in fast mode; `mode=balanced skip=q1` skips the alternative-seam question.

**Mode safety override.** If `mode=fast` is requested but the change touches auth, permissions, payments, secrets, schema migrations, destructive deletes, background jobs, queues, cron, external APIs, email/SMS/push, imports/exports, file writes, spawned processes, IPC, caching/invalidation, feature flags, analytics/business reporting, concurrency-sensitive mutations, or external webhooks, surface the conflict via `AskUserQuestion` and confirm before honoring. The `/ship` orchestrator enforces this upstream — direct manual callers may not.

**Phase-gated NEVER scope.** When `mode=fast` is in effect, two NEVERs are explicitly suspended for the run: *"NEVER implement the user's literal proposal without naming one alternative"* and *"NEVER agree with the user's framing of effort before completing Q2"*. The remaining NEVERs (contract audit, peer-data consumers, scope creep, manual-override, stop-action symmetry, rename-realign boundary) stay in force in every mode — they protect against silent breakage that fast mode shouldn't override.

---

## Before you touch code, answer four questions

**Always use the AskUserQuestion tool** (multi-question, structured choices) when you need clarification from the user — never present static numbered prompts they have to type answers to. Fall back to free-form prose only when the option space is genuinely open-ended.


1. **Is the user's proposal the best seam?** They named one approach. Find at least one alternative — different layer (UI vs server vs data), different trigger (push vs pull, eager vs lazy), different ownership (existing module vs new). State the tradeoff. If their proposal still wins, say why; if not, surface the alternative *before* implementing.

2. **What contracts shift?** List every place the *meaning* of something changes: types, API responses, persisted rows, UI states, user expectations, docs, tests asserting the old behavior. The extension is done when all of these are coherent, not when the new path works.

   **Audit order:** types → API/IPC surface → persisted rows/migrations → UI states & conditionals → runtime/lifecycle state (spawned processes, child terminals, timers, watchers, in-memory registries — and which UI surface projects each one's liveness) → tests asserting old behavior → user-facing docs/copy → peer consumers (other components/hooks/routes reading or caching this same entity) → live-update wiring (event subscriptions, query invalidations, refetch triggers, and runtime-state projections like status badges, indicator dots, "is alive" booleans — name what owns the truth and how each reader stays consistent with it). Walk the list in this order; later layers depend on earlier layers' decisions.

3. **Where's the boundary?** If the change touches 3+ unrelated modules, renames a domain concept, or invalidates persisted data, it's not an extension — stop and recommend `realign` or a feature-build approach instead. **Scope-explosion fallback:** if the audit in Q2 surfaces more than ~10 affected sites, that itself is the signal — stop and re-scope, even if implementation has already started.

4. **What edge cases does the user's framing miss?** User overriding the derived value manually. Pre-existing rows that predate the extension. Failure of the new derivation step. Re-derivation when the source changes after the fact.

   **Symmetric data-flow:** when adding a new *reader* of shared data, list the mutations that must invalidate it; when adding a new *mutation*, list the readers that must refresh.

   **Cold-start reconciliation:** on process/app restart, what's the source of truth for this feature's runtime state — persisted disk, a runtime probe (is the child process actually alive?), or "assume offline until re-triggered"? Decide explicitly; default-persist is a decision, not an absence of one. Stale persisted state that outlives its underlying runtime (a "running" row pointing at a dead PID, a green dot for a terminal that no longer exists) is the canonical bug class here.

## Logic-first lane

If the extension changes a deterministic parser, validator, pricing rule, permission rule, data transform, state machine, API/data contract, or non-trivial branch, write the expected behavior test before editing production code. In `production`, this is mandatory. In `balanced`, run it unless the project has no harness or the change is trivial UI wiring. In `fast`, run it only when the user passed `include=logic-first` or `include=tests`.

## Integration-first lane

If the extension touches HTTP/webhook dispatch, queues, jobs, cron, IPC, MCP tool calls, file writes, env-var injection, spawned processes, external APIs, email/SMS/push, imports/exports, or cache invalidation, name the runtime contract before editing: trigger, dispatch site, receiver, persisted/visible outcome, and log/observation location. Dispatch the **`runtime-contract-tracer`** subagent (via `Agent(subagent_type=runtime-contract-tracer)`) to extract the 4-link trace with file:line refs in a fresh context — the result is the input to your planning. After verification, invoke `agentsystem-core:add-observability` unless equivalent structured evidence already exists and you can name where it lives.

## After editing

1. Verify the changed code path, not just the build.
2. Dispatch the **`reviewer-contracts`** subagent (via `Agent(subagent_type=reviewer-contracts)`) when the change crosses client/server, route/schema, IPC, DTO, generated-client, or API boundaries. Apply auto-fixable renames; surface structural mismatches.
3. Dispatch the **`reviewer-concurrency`** subagent (via `Agent(subagent_type=reviewer-concurrency)`) when the change touches mutations, jobs, webhooks, retries, idempotency, transactions, or async UI writes. Apply auto-fixable items (AbortController injection); surface the rest.
4. Dispatch the **`reviewer-observability-coverage`** subagent (via `Agent(subagent_type=reviewer-observability-coverage)`) after critical-path async/error/integration changes; if it reports missing evidence, invoke `agentsystem-core:add-observability`.
5. Dispatch the **`reviewer-data-integrity`** subagent (via `Agent(subagent_type=reviewer-data-integrity)`) when the change touches migrations, schema, persistence, imports/exports, deletes, denormalized data, or data-access invariants. The subagent returns a change classification (additive/mutating/destructive) plus severity-ranked findings; apply auto-fixable seed-fixture renames and surface the rest.
6. Dispatch the **`reviewer-security-regression`** subagent (via the `Agent` tool with `subagent_type=reviewer-security-regression`) when the change touches backend execution, auth, payments, file upload, webhook signing, secrets/env, external APIs, unsafe redirects, or user-rendered HTML. The subagent runs read-only and returns a severity-ranked findings report; apply the `auto-fixable: true` items mechanically and surface the rest to the user. If the change specifically adds or modifies authorization/ownership checks on a server entry point (TanStack server function, route handler, tRPC procedure, GraphQL resolver, webhook handler, queue worker, IPC handler), also dispatch the **`reviewer-authz`** subagent (via `Agent(subagent_type=reviewer-authz)`) — the security-regression auditor covers the broader surface but defers authorization to this auditor. The `agentsystem-core:audit-authz` skill remains available as a manual entry point.
7. Dispatch the **`reviewer-error-boundaries`** subagent (via `Agent(subagent_type=reviewer-error-boundaries)`) when the change alters a user-facing async flow, route loader, form submit, server action surfaced in UI, or background failure path. Apply auto-fixable items; surface the rest.
8. Dispatch the **`reviewer-loading-states`** subagent (via `Agent(subagent_type=reviewer-loading-states)`) when the change alters async UI (`useQuery`, `useSuspenseQuery`, `useMutation`, optimistic updates, submit pending state, polling, client fetches). Apply auto-fixable items; surface the rest.
9. Dispatch the **`reviewer-accessibility-regression`** subagent (via `Agent(subagent_type=reviewer-accessibility-regression)`) after interactive UI mutation (buttons, forms, dialogs, focus, custom click targets, error messages). Apply auto-fixable items; surface the rest.
10. Dispatch the **`reviewer-client-bundle`** subagent (via `Agent(subagent_type=reviewer-client-bundle)`) when client routes/components/hooks change, new dependencies are imported in UI, or server-only code might leak into the browser bundle.
11. Add or expand tests for backend logic, data transformations, permissions, contracts, persisted data, non-trivial branching, async behavior, and business rules — invoke `agentsystem-core:write-tests` so the new behavior is covered using the project's existing harness and conventions. When the extension changes a user-facing flow that warrants browser coverage and the project has Playwright (or the user approves installing it), also invoke `agentsystem-core:add-e2e-test`. In `production`, this step is mandatory; in `balanced`, run unless the change is trivial UI wiring; in `fast`, opt in only via `include=tests`.

## Stack-conditional adjuncts

- **TanStack Start:** run `agentsystem-launch-kit:code-enforce-route-data` when the diff creates/edits `src/routes/**`, adds a loader, adds `useQuery`/`useSuspenseQuery`, edits `src/queries/**`, or changes in-app navigation. Run `agentsystem-launch-kit:code-enforce-layers` when the change crosses route/component/hook/query -> `src/fn/` -> use-case/data-access/DB boundaries. Use `agentsystem-launch-kit:add-form` when the extension is a new create/edit form in a TanStack Start app. Use `agentsystem-launch-kit:add-skeleton-loaders` and `agentsystem-core:add-empty-error-states` for newly wired route data that needs loading/empty/error states.
- **Backend schema:** invoke `agentsystem-core:add-migration` before editing migrations for schema changes, then dispatch the **`reviewer-data-integrity`** subagent.

## NEVER

- **NEVER implement the user's literal proposal without naming one alternative**
  **Instead:** Surface the alternative seam in one sentence, state the tradeoff, then ask or proceed with reasoning.
  **Why:** Users propose the solution shape from their current vantage point; the cleaner seam is often one layer up or down. Implementing literally locks in the wrong shape.

- **NEVER ship the new path without auditing adjacent contracts**
  **Instead:** Grep for callers/consumers of the changed type/field/state and decide explicitly whether each adapts, breaks, or is unaffected.
  **Why:** Extensions shift requirements; stale assumptions in adjacent code become silent bugs that surface later when no one remembers the change.

- **NEVER add a new consumer of shared data without checking how peers stay live**
  **Instead:** Grep for other readers of the same entity/endpoint (lists, current-user, settings, project/workspace metadata — anything fetched in more than one place). Verify they share a cache or each subscribe to the mutation signal. If neither, propose consolidating into a shared query/store before adding a second ad-hoc fetch.
  **Why:** Each ad-hoc `useState + fetch` becomes an island the next mutation has to remember to invalidate. Rename-style mutations (same id, no navigation) won't incidentally refresh peers — the bug ships silently and only surfaces in production.

- **NEVER expand scope to "while we're here" cleanups**
  **Instead:** Note the cleanup opportunity in the response and stop.
  **Why:** Extensions are dangerous because they're framed as small. Bundling cleanup makes the diff unreviewable and hides the requirement shift inside structural noise.

- **NEVER treat manual override as a future problem**
  **Instead:** Decide upfront: does the derived value lock the field, suggest into it, or fully replace user input? Make it explicit in the implementation.
  **Why:** "Auto-derive X" almost always collides with the user's existing ability to set X manually. Skipping this decision creates UX bugs the next session has to retro-fix.

- **NEVER agree with the user's framing of effort before completing Q2**
  **Instead:** Run the contract audit first, then confirm or push back on scope.
  **Why:** Small-feeling extensions routinely have 5x the contract surface the proposal implies. Agreeing early anchors scope incorrectly and locks the agent into a too-small mental budget for the real work.

- **NEVER add a stop/cancel/remove/disable action without enumerating every side-effect of its start/create/add/enable counterpart**
  **Instead:** List spawned children (processes, terminals, workers), persisted rows, in-memory registries/maps, UI badges and indicator state, event listeners, pollers, and any cached "is alive" derivations created by the start path. The stop path must address each — kill, delete, unregister, reset, unsubscribe — or explicitly defer with a reason.
  **Why:** Stop actions are framed as deletions but are really *reconciliations*. Missing one inverse leaves a zombie (orphan terminal still running, status dot still green, ghost row in a registry) that surfaces only after restart or the next interaction with the stale surface.

- **NEVER proceed when the change crosses into rename/realign territory**
  **Instead:** Stop and recommend the `realign` skill, or propose breaking the work into (a) extension and (b) follow-up rename.
  **Why:** A rename masquerading as an extension drags every leak site into one diff and gets misreviewed as a small change.

## When you're done

Before reporting completion, restate: (a) the contract that shifted, (b) the alternatives you considered and rejected, (c) the edge cases handled and the ones explicitly deferred. If you can't fill all three, you skipped the thinking — go back.

---

## Post-step: /simplify

After the extension lands, run `agentsystem-core:simplify` against the diff to catch newly-introduced duplication, parallel-pattern drift, missed reuse of existing utilities, and parameter sprawl from grafting onto the existing shape.

## Post-step: /polish-ui (UI changes only)

If the diff touches UI files (`src/components/**`, `src/routes/**`, `src/pages/**`, `app/**` — `.tsx`/`.jsx`), run `agentsystem-core:polish-ui` to verify kbd hints on hotkey-bound buttons, focus management, loading/disabled states, and footer/chrome consistency. Skip when the UI delta is a one-line copy or style tweak.
