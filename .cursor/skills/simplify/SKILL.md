---
name: simplify
user-invocable: false
metadata:
  audience: handoff
description: Internal handoff target invoked as a post-step by add-feature, modify-feature, fix-bug, fix-pr-tests, address-pr-comments, remove-feature, realign, and reorganize-files to clean up freshly-changed code. Reviews the git diff for DRY violations, duplicate code, oversized files/functions/components, magic numbers, poor naming, tight coupling, missed reuse of existing utilities, and inefficient patterns; refactors in place without breaking behavior. Writes a safety-net test first when the refactor risks behavior change. Default scope is changed files; expands to siblings only when a flagged smell points there. Trigger phrases for routing: "simplify", "clean this up", "DRY this", "find code smells", "any duplication", "split this up". Skip for type-only edits, pure formatting, generated files, and changes the user has explicitly scoped to "no refactor".
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Code Simplify

Refactor freshly-changed code into a smaller, drier, better-named, less-coupled version — without changing behavior. Default scope is the working-tree diff against the merge-base of the current branch and its upstream/base.

---

## Phase 1 — Scope

1. Run `git diff --name-only` and `git diff --merge-base <base>` to identify changed files. If no diff, ask the user which files to scope.
2. Read each changed file in full and the diff hunks. Note imports — utilities the new code might duplicate often live next to or one directory up from the changed file.
3. State the scope back to the user as a list before reviewing: "Reviewing N files: [list]. Will reach into siblings only if a flagged smell points there."
4. **Scope guard.** If the diff names >50 files or spans an unrelated branch base (e.g., the user just rebased onto a different upstream), STOP and ask the user to narrow scope before reviewing. /simplify is a focused pass; aimed at a whole src/ it produces noise instead of fixes.

---

## Phase 2 — Safety Net (before any structural refactor)

Decide per change:

- **Mechanical fix** (rename a single-file local symbol, extract pure constant for magic number, swap inline logic for an existing util, delete a dead comment, collapse an unnecessary wrapper) → no test required; apply directly in Phase 4. **Exclusion:** renaming an *exported* symbol crosses module boundaries — every importer must update — so route it through the structural-fix gate, not the mechanical path.
- **Structural fix** (extract function across module boundary, split a component, move logic between layers, replace a duplicated block with a shared helper) → behavior could shift. If the touched code path has no covering test, invoke `agentsystem-core:write-tests` for that path BEFORE refactoring. The test must run green against the current code first; that's the safety net.

If `write-tests` cannot wire a test (no harness, third-party-only path, UI without test infra), STOP and ask the user: "(a)pply mechanical fixes only / (b)refactor without a test net / (q)uit". Default to (a).

---

## Phase 3 — Parallel Review Fan-Out

> **Trigger question for every duplicate block flagged:** "Do these two callsites change for the same reason?" If no, leave them duplicated — premature DRY couples unrelated callers and is worse than copy-paste.

**MANDATORY — READ [`references/code-smells.md`](references/code-smells.md)** before launching the agents. The headline list below is the high-leverage subset; the reference file holds the full catalog each agent should scan against.

Launch three agents concurrently in a single message. Pass each the full diff, the list of changed file paths, and a pointer to `references/code-smells.md`.

### Agent 1 — Code Reuse

For each change:
- Search for existing utilities and helpers that could replace newly written code. Common locations: utility directories (`lib/`, `utils/`, `helpers/`), shared modules, files adjacent to the changed ones, and files imported by neighboring code.
- Flag any new function that duplicates existing functionality. Suggest the existing function to use instead, with its file path and signature.
- Flag inline logic that could use an existing utility — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, date math, deep-equality checks.
- Flag duplicate code blocks within the diff itself (copy-paste of 3+ lines with minor variation).

### Agent 2 — Code Quality

Headline items (full list in `references/code-smells.md`):
- **DRY violations** — near-duplicate blocks encoding the same rule
- **Long files / functions / giant UI components** — split at natural seams
- **Magic numbers and strings** — name by business meaning
- **Poor naming** — non-self-describing variables, functions, booleans
- **Tight coupling / API duplication** — pull repeated cross-module logic into a helper
- **Nested conditionals 3+ deep** — flatten with early returns or a lookup table

### Agent 3 — Efficiency

Headline items (full list in `references/code-smells.md`):
- **Unnecessary work** — redundant computation, duplicate I/O, N+1 patterns
- **Missed concurrency** — independent ops run sequentially
- **Hot-path bloat** — blocking work added to startup or per-render paths
- **Recurring no-op updates** — unconditional notifications in loops/handlers
- **Memory** — unbounded structures, missing cleanup, listener leaks

---

## Phase 4 — Apply Findings (gated)

Consolidate findings into a numbered list grouped by file. Each item: severity (critical / suggested / nit), category, location, proposed fix.

Apply via `skill-forge-hitl`-style per-item gate when available; otherwise:

- **Auto-apply** (no per-item prompt): mechanical fixes only — magic-number → named constant, swap inline logic for an existing util the agent confirmed exists, rename a single-file local variable, delete dead comment, collapse a one-child wrapper.
- **Prompt before apply**: every structural fix (extract, split, decouple, move). Show before/after intent in one sentence; user replies `(a)pply / (s)kip / (q)uit`.

Run the safety-net test from Phase 2 after each structural fix. If it goes red, revert that fix and surface why.

---

## Phase 5 — Re-Verify and Report

1. Run the project's typecheck and the safety-net tests once more.
2. Print a summary: applied N fixes, skipped M, surfaced K (couldn't auto-fix). Group by category.
3. If any Agent 1 finding pointed to siblings outside the diff with the same smell, list them and ask: "Expand scope to fix these too? (y/N)". Do not silently expand.

---

## NEVER

- **NEVER refactor structural code without a covering test running green first**
  **Instead:** invoke `agentsystem-core:write-tests` for the touched path, confirm green, then refactor.
  **Why:** "looks equivalent" refactors regularly break behavior in branches the diff doesn't cover; the test is the only proof.

- **NEVER expand scope beyond the diff silently**
  **Instead:** surface the sibling smell as a question with file paths and ask before touching.
  **Why:** users invoke /simplify expecting a focused pass on what they just wrote — a 40-file rewrite shatters trust and conflicts with in-flight work.

- **NEVER replace a magic number with a constant whose name restates the value**
  **Instead:** name it after the business meaning (`MAX_RETRY_ATTEMPTS`, not `THREE`).
  **Why:** `const FIVE = 5` is the same code with extra steps; the value of extraction is encoding intent.

- **NEVER extract a "shared helper" from two near-duplicate blocks without confirming they'll evolve together**
  **Instead:** if the two callsites have different reasons to change, leave them duplicated. Extract only when the duplication encodes one rule.
  **Why:** premature DRY couples unrelated callers — every future change to one forces a fork or a flag, which is worse than copy-paste.

- **NEVER split a file just because it's long**
  **Instead:** split when there's a natural seam (independent concern, separately-tested unit, separately-imported export). A 400-line file with one cohesive concern is fine.
  **Why:** splitting cohesive code scatters context and makes navigation worse, not better.

- **NEVER apply structural fixes in batch without per-fix verification**
  **Instead:** apply one structural fix, run the test, then move to the next.
  **Why:** batched refactors hide which change broke the test; isolating each restores bisectability.

- **NEVER add comments while refactoring to explain what you did**
  **Instead:** let the rename / extraction / structure speak. If a future reader still needs WHY, add one line.
  **Why:** "// extracted from X" rots immediately and pollutes the file; the git history holds the trail.
