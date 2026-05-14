---
name: fix-pr-tests
description: Diagnose and fix failing CI tests on a GitHub pull request. Pulls failing job logs via `gh pr checks` / `gh run view`, reproduces the failure locally, classifies it as real-bug vs. stale-test vs. flake, applies the minimum fix to the correct side (production code OR the test, never both as a guess), and re-verifies before pushing. Trigger phrases — "fix the failing tests on this PR", "PR checks are red", "ci is failing on my pull request", "fix pr #123", "/fix-pr-tests", "tests broke on the pr", "make ci green". Skip for — local test failures unrelated to a PR (use fix-bug), failing lint/build steps that aren't tests (use the relevant fix skill), or PRs the user explicitly said not to push to.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Fix PR Tests

A failing PR test means **one** of three things. Get the classification right before touching code — fixing the wrong side either ships a real bug masked by a "fixed" test, or wastes time changing prod code when the test was just stale.

---

## Phase 1 — Locate the failure

1. Resolve the PR: explicit `<PR#>` from the user, otherwise `gh pr view --json number,headRefName` for the current branch. If neither resolves, stop and ask.
2. List failing checks: `gh pr checks <PR#>` — note every failing job (don't fix the first one and assume the rest are duplicates).
3. For each failing job, fetch the run ID and pull logs:
   ```
   gh run view <run-id> --log-failed
   ```
   `--log-failed` skips the green steps. Read the actual assertion message, file path, and line — not just "tests failed".
4. Extract: failing test name(s), file path, assertion/error message, stack frames pointing into project code.

**Checkpoint — do not proceed without:** test name, file:line, exact error. If logs are truncated or missing, fetch the full log with `gh run view <run-id> --log` before guessing.

---

## Phase 2 — Reproduce locally

Run **only the failing test** first, not the suite. Goals: confirm it fails the same way locally, and get a fast iteration loop.

Before reproducing, ask: what could differ between local and CI? (env vars, timezone, seed, parallelism, OS, FS case-sensitivity).

- Detect runner from project (`package.json` scripts, `pytest.ini`, `go.mod`, etc.) — do not assume.
- Use the runner's single-test filter (`vitest run <file> -t "<name>"`, `pytest path::test_name`, `go test -run TestName ./pkg`, etc.).
- If it **passes locally** but fails in CI: this is a CI-environment signal (env var, timezone, fixture seed, parallelism, OS). Do NOT edit the test to make CI green — investigate the env delta first. Common deltas: `TZ`, `CI=true` branches, `Date.now()` / random seeds, file-system case sensitivity, network egress.
- If it **fails locally** the same way: continue to Phase 3.
- If it **fails locally differently**: the local environment is also broken — note both failures; the CI one is still the source of truth.

---

## Phase 3 — Classify (real bug vs. stale test vs. flake)

This is the load-bearing decision. Before classifying, read both the test AND the production code it exercises.

Ask, in order:

1. **Is this a flake?** Re-run the single test 3× locally. If it alternates pass/fail with no code change → flake. Look for: `Date.now()`, `Math.random()`, unseeded fixtures, timing-based assertions, ordering assumptions on unordered collections, shared global state across tests. Fix the **flakiness source** (seed it, freeze time, sort before compare) — never paper over with retries unless the underlying nondeterminism is genuinely external.

2. **Did the test's intent change recently?** `git log -p <test-file>` and `git log -p <prod-file>` over the PR's commit range. If the PR intentionally changed behavior and the test still encodes the old behavior → **stale test**. The fix is to update the test's expected values to match the new, intentional behavior.

3. **Did production code regress?** If the test encodes a contract (public API shape, documented behavior, business rule) and the PR's prod-code change broke it → **real bug**. The fix is in the production code; the test stays as-is.

4. **Ambiguous?** When you cannot tell whether the new behavior is intentional, **stop and ask the user**. Do not guess. Phrase: "Test `X` expects `A`, code now returns `B`. Is `B` the intended new behavior (I'll update the test) or a regression (I'll fix the code)?"

**Checkpoint — write down the classification and one-sentence justification before editing anything.**

---

## Phase 4 — Fix

Apply the fix to the side the classification picked. Keep the diff minimal.

- **Real bug:** fix production code. Do not also "tighten" the test in the same change.
- **Stale test:** update only the assertions that reflect the changed behavior. If you find yourself rewriting the whole test, the classification was probably wrong — re-check Phase 3.
- **Flake:** fix the source of nondeterminism in the test or fixture. Adding a `retry(3)` is not a fix.

After fixing one failure, **scan sibling tests** for the same root cause before pushing. One regression often breaks N tests; fixing one and pushing means another red CI in 5 minutes.

---

## Phase 5 — Verify, then push

1. Re-verify: failing test → containing file → full suite only if the fix touched shared code (utilities, types, schemas, config).
2. Commit with a message that names the failure and the classification: e.g. `fix: handle null user in formatName (regression caught by formatName.test.ts)` or `test: update formatName expected output for new locale rule`.
3. Push to the PR branch. Then `gh pr checks <PR#> --watch` (or poll) until CI re-runs. If still red, return to Phase 1 with the new logs — do not assume a second failure is the same as the first.

---

## NEVER

- **NEVER edit a test to make it pass without classifying first**
  **Instead:** Complete Phase 3 and write down the classification before opening the test file.
  **Why:** Editing the assertion is the fastest way to make CI green and the fastest way to ship a real regression. The test was the alarm; silencing the alarm doesn't fix the fire.

- **NEVER fix the prod code AND the test in the same change when only one was wrong**
  **Instead:** Pick one side based on Phase 3. If both genuinely need to change (e.g., intentional API rename), say so explicitly in the commit message.
  **Why:** Touching both sides together hides which one was the actual defect and prevents future bisects from isolating cause.

- **NEVER push a fix without reproducing the failure locally first**
  **Instead:** Phase 2 must show the same failure on your machine before Phase 4. If it won't reproduce, that's the bug to investigate, not a reason to push speculatively.
  **Why:** Push-and-pray burns CI minutes, pollutes the PR's commit history with "try again" commits, and misses CI-environment-specific bugs that won't be caught by speculative fixes.

- **NEVER classify a single failure as a flake without re-running 3×**
  **Instead:** Re-run locally with the same seed/env at least three times. Only call it a flake if it actually alternates.
  **Why:** "Probably flaky" is the most common cover story for a real intermittent bug. Calling a deterministic failure a flake means the bug ships and re-surfaces under load.

- **NEVER skip sibling-test scan after fixing one failure**
  **Instead:** After Phase 4, grep the codebase for tests that touch the same prod symbol/file before pushing.
  **Why:** A single root cause usually breaks multiple tests. Fixing only the first one named in logs guarantees a second red CI run on the same PR.

- **NEVER edit `.github/workflows/` or CI config to make a test pass**
  **Instead:** Treat CI config as out of scope for this skill. If the test genuinely needs different CI setup (new env var, service container), surface it to the user; don't silently disable the job, downgrade strictness, or add `continue-on-error`.
  **Why:** Editing CI to dodge a failing test is a stronger version of editing the test itself — it disables the alarm for every future PR, not just this one.

---

## Post-step: /simplify

After CI is green, run `agentsystem-core:simplify` on the fix diff — test-fix patches often introduce duplicated helpers, magic numbers, or shortcut code that should be cleaned up before merging.
