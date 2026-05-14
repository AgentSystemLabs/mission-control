---
name: realign
user-invocable: false
metadata:
  audience: handoff
description: Internal handoff target invoked by add-feature, modify-feature, or fix-bug when they detect a domain-model rename — an enum/state/vocabulary change with persisted values that requires a tracked data migration. Users typically don't invoke this directly; the front-door skill routes here once the work is identified as a realignment (changes meaning) rather than a refactor (preserves behavior) or cleanup (no requirement change). Trigger phrases for routing: "rename this status", "these states don't match how it actually works", "the model is out of sync", "enum migration", "state machine rename", "domain model update", removing a dead enum value, adding a new lifecycle state, renaming a persisted enum. Skip for behavior-preserving structural changes (refactor) or stylistic tidying (cleanup).
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Code Realign

A realignment changes the **meaning** of a code model so it matches a changed business requirement. It is not a refactor (which preserves behavior) and not a cleanup (which has no new requirement). Naming the work correctly sets reviewer expectations and surfaces hidden scope — most importantly, **persisted data migration**.

Work the phases in order. Do not skip Phase 1 — getting the vocabulary wrong contaminates every later phase.

> Single-file by design. The Process pattern at this scope reads better whole than split into references; revisit if the body grows past ~300 lines.

---

## Before you start, ask:

- Is this a realignment, a refactor, or a cleanup? Realignment changes meaning; refactor preserves behavior; cleanup has no new requirement. Wrong label, wrong scope.
- Does any persisted store (database, file, external API) hold the old values? If yes, a data migration is in scope — non-negotiable.
- What is the user's domain word for each new state? Use their vocabulary, not the code's leftovers.

---

## Phase 1 — Confirm and name the work

Before editing anything:

1. State the **old model** and the **new model** to the user in one paragraph each. Use the user's domain words, not the code's leftovers.
2. Confirm: "This is a realignment — the type/state vocabulary will change, and any persisted rows holding old values will need migrating. Refactor and cleanup do not include data migration. Sound right?"
3. If the user pushes back ("just rename it" / "no DB changes needed"), ask whether old values exist in persisted state. If yes, migration is in scope whether or not they call it that.

**Exit condition:** the canonical new state set is written down (e.g. `["ready", "running", "needs-input", "finished", "terminated"]`) and the user has agreed to it.

---

## Phase 2 — Map old → new explicitly

Write the mapping before touching code:

```
old_value_1 → new_value_a
old_value_2 → new_value_a   (collapsed)
old_value_3 → new_value_b
old_value_4 → DROPPED        (dead, no transitions ever produced it)
                  → new_value_c (new, no old equivalent)
```

**Worked example** (task-status realignment):

```
idle  → finished     (Stop hook target — was misnamed)
done  → finished     (collapsed; only one terminal state for "Claude finished its turn")
failed → DROPPED     (no transition ever wrote it)
                 → terminated  (new — produced by a PTY-exit listener)
ready, running, needs-input → unchanged
```

This table drives both the code rename **and** the data migration. Keep it visible in the conversation.

**Exit condition:** every old value has a destination (mapped, collapsed, or dropped) and every new value has a producer (existing transition, new transition, or initial state).

---

## Phase 3 — Rename at the type root, then sweep with the type checker

1. Edit the canonical type/enum definition first (e.g. the `as const` array, the schema column type).
2. Run the project's type checker (`tsc --noEmit`, `mypy`, `cargo check`, etc.). Every error is a leak site that needs updating per the Phase 2 mapping.
3. Fix errors top-down. Re-run until clean.

The type checker is the cheapest sweep tool — use it before grepping. But it only catches sites that go through the type system.

**No type checker available?** (untyped JS, plain Python without mypy, dynamic languages.) Grep for the canonical type/enum's definition site and audit every importer/reader by hand. This is slower and less complete — allocate more time for Phase 4 to compensate.

---

## Phase 4 — Hunt the non-typed leaks

The type checker will not catch:

- **String literals in non-typed contexts**: doc examples, `curl` snippets in settings pages, log messages, test fixtures, config files
- **CSS custom properties** named after states (`--status-done`, `--status-failed`) — but check before renaming: they may be reused for unrelated styling (e.g. `--status-failed` repurposed as a danger color on delete buttons). Keep the variable, only remap the meta layer.
- **External payloads**: hook event mappers, webhook handlers, API request/response shapes that hand-construct status strings
- **Comments and identifiers** containing the old name (`isDone`, `markIdle`, `// running until done`)

Grep for every old value as a string, including in `.md`, `.css`, `.json`, and test files. Audit each hit; do not blanket-replace.

**Exit condition:** `grep -rn '"old_value_1"\|"old_value_2"\|...'` returns nothing relevant.

---

## Phase 5 — Migrate persisted data, properly

If any old values exist (or could exist) in a database, file, or external store, you owe a migration. Follow the project's existing pattern.

### Detect the existing pattern first

- Look for a `migrations/` directory, a migration runner, a `schema_migrations`-style tracking table, or framework conventions (Drizzle, Alembic, Rails, Prisma).
- Read one or two existing migrations. Match the file naming, the SQL style, and how they're applied at runtime.
- If an auto-generator (e.g. `drizzle-kit generate`) produces a migration, **read it before accepting it**. Generators that diff the schema may emit a baseline that doesn't match how the app actually bootstraps (e.g. apps using idempotent `CREATE TABLE IF NOT EXISTS` at startup). Throw away mismatches; write the migration by hand.

### If no migration system exists

Add the smallest one that fits: a `schema_migrations` (or equivalent) table tracking applied filenames, plus a runner invoked once at startup that applies pending files in lexical order inside a transaction. Bundle migration files via the project's normal asset/import mechanism (e.g. `import.meta.glob` with `?raw` for Vite-built servers).

### Apply it now

After committing the migration file, run it against the developer's local environment so stale data is fixed immediately — not "on next boot." Verify with a count query that no old values remain.

---

## Phase 6 — Verify

Verify: typecheck clean; grep for old values returns nothing (except the migration file itself); count query on persisted data returns zero; spot-check at least one new state through the UI/API.

**Exit:** all four checks pass. If any fail, return to the failing phase.

---

## Post-step: data-integrity audit

If Phase 5 touched persisted data, migrations, status/enum values, denormalized data, or data-access invariants, dispatch the **`reviewer-data-integrity`** subagent (`Agent(subagent_type=reviewer-data-integrity)`) before `simplify`. The realignment is not complete until the data-integrity pass either reports no issues or every finding is fixed or explicitly surfaced.

---

## NEVER

- **NEVER inline data migrations in bootstrap/`ensureSchema` code as raw `UPDATE` statements**
  **Instead:** Add a versioned, tracked migration file applied once and recorded in a `schema_migrations` table.
  **Why:** Inline UPDATEs run on every startup with no audit trail, no rollback story, no way to tell "did this happen on this DB?" Bootstrap code is for idempotent shape (CREATE IF NOT EXISTS), not data rewrites.

- **NEVER call a realignment a "refactor" in commit messages or PR titles**
  **Instead:** Use "realign", "rename", or "remodel" — words that signal behavior changed.
  **Why:** Reviewers reading "refactor" expect zero behavior change and skim the diff. Realignments shift state-machine semantics and persisted enums; they need actual review.

- **NEVER accept an auto-generated migration without reading it against how the app actually applies migrations at runtime**
  **Instead:** Open the generated file, compare to existing migrations and the runtime bootstrap path, and rewrite by hand if they conflict.
  **Why:** Generators diff the schema in isolation. If the app uses idempotent CREATE-IF-NOT-EXISTS or a custom runner, the generated baseline can claim to create tables that already exist, leaving the migration system in a broken state on every existing DB.

- **NEVER rename CSS variables or other named constants just because they share a name with an old state value**
  **Instead:** Check usages first. If the variable is reused for unrelated styling (a delete button using `--status-failed` as a danger red), keep the variable name and only remap the state→variable mapping in the meta layer.
  **Why:** Cascading renames into unrelated styling breaks UI in places the type checker will never visit.

- **NEVER start editing before the old → new mapping is written down and agreed**
  **Instead:** Do Phase 1 and Phase 2 in conversation, then edit.
  **Why:** Mid-edit vocabulary changes leave the codebase in a hybrid state where some sites use the old names, some the new, and the type checker can't tell you which is canonical.

- **NEVER treat "the type checker is clean" as the end of the sweep**
  **Instead:** Run Phase 4 (grep for string literals, audit non-typed leaks) every time.
  **Why:** Doc examples, `curl` snippets, hardcoded fixtures, and webhook payload constants are invisible to the type system but visible to users and integrations.

---

## Post-step: /simplify

Renames sometimes leave behind translation helpers, transitional aliases, or branches that handled the old vocabulary. Run `agentsystem-core:simplify` on the diff to collapse what's now dead code and catch parallel patterns the rename may have created.
