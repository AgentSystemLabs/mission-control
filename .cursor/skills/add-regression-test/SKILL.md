---
name: add-regression-test
description: After a bug fix lands (or is staged), generate a regression test that fails on the pre-fix code and passes on the post-fix code — pinning the bug so it can't silently return. Walks the agent through reproducing the failure first (against the pre-fix state via `git stash` or temporary revert), writing the assertion that captures it, then verifying the test goes red without the fix and green with it. Trigger phrases — "add a regression test", "pin this bug", "write a test for the fix", "/add-regression-test", "lock in this bug fix", "make sure this doesn't come back", or invoke automatically after a /fix-bug session that produced a code fix. Skip for — fixes whose behavior change is already covered by existing passing tests, pure refactors with no behavior delta, fixes to test code itself, and unreproducible heisenbugs.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Add Regression Test

A regression test is only valuable if it would have failed before the fix and passes after. Anything else is a confidence test pretending to be a regression test. The whole skill is built around proving both halves.

---

## Phase 1 — Identify the Fix

Determine what changed:

- If the fix is staged or committed but not pushed: `git diff <base>..HEAD -- <files>` and `git log <base>..HEAD --oneline`.
- If the fix is in the working tree: `git diff` (unstaged) plus `git diff --cached` (staged).
- If the user names a commit: `git show <sha>`.

Read the changed code. Identify:
- The function / route / component the fix lives in
- The input shape that triggers the bug (from the diff context, the bug report, or the user)
- The expected externally-observable outcome (return value, DB row, HTTP response, emitted event, rendered DOM)

If the fix is purely structural (renames, refactor, reformatting) with no behavior delta — stop. Tell the user there is nothing to regression-test.

**Exit:** the bug's input shape and expected outcome are written down.

---

## Phase 2 — Detect Test Harness

Apply the harness-detection rules from `write-tests` (or use that skill's references file directly): config files, lockfile, scripts. If no harness exists, hand off to `write-tests` Phase 3 to install one — do not introduce a runner here.

**Exit:** the runner command and the test-file convention are known.

---

## Phase 3 — Reproduce the Failure

This is the load-bearing step. **MANDATORY — READ [`references/reproduction-modes.md`](references/reproduction-modes.md)** before choosing a mode.

Pick one mode:

- **A. Fix is unstaged in working tree** → write the test, `git stash` only the fix files, run the test (must fail), `git stash pop`, run the test (must pass).
- **B. Fix is staged but not committed** → write the test, `git stash --keep-index` to set aside the test, then `git stash pop`-trick won't work cleanly; instead use mode C.
- **C. Fix is committed locally** → write the test on top, then `git revert --no-commit <fix-sha>` in a temporary worktree (or via `git stash` of the fix files), confirm the test fails, restore.
- **D. Fix is squashed into a larger commit and can't be cleanly isolated** → revert just the offending hunks via `git checkout <pre-fix-sha> -- <file>` in a worktree, confirm test fails, restore.

In every mode, the gate is the same: **the test must fail without the fix code present.** A test that passes both before and after is broken — go back and tighten the assertion.

**Exit:** the test failed against the pre-fix code with output that names the actual bug behavior (not "expected X, got undefined" — the failure message should resemble the original bug report).

---

## Phase 4 — Verify the Pass

Restore the fix, run the test. It must pass.

If it doesn't pass: either the assertion is wrong (too strict, asserting unrelated behavior) or the fix is incomplete. Surface to the user — do not loosen the assertion to make it green.

**Exit:** test passes with the fix in place.

---

## Phase 5 — Wire It In

- Place the test in the project's convention (colocated `<name>.test.ts`, `tests/`, `__tests__/`, etc. — match the nearest sibling).
- Name it after the bug's *symptom*, not the fix: `it("returns 404 when slug contains uppercase letters")`, not `it("normalizes slug case")`. The next reader needs to recognize the bug from the test name.
- If a bug tracker reference exists (issue #, ticket id), include it in a one-line comment above the test.

Run the full suite — the new test plus its neighbors must all pass.

**Exit:** test is in place; full suite is green.

---

## Phase 6 — Report

```
Regression test added: <path>:<line>
  Pinned: <one-line bug description>
  Verified failed against: <pre-fix sha or "stashed working tree">
  Verified passes against: HEAD
  Run: <project test command>
```

---

## NEVER

- **NEVER skip the failure verification.**
  **Instead:** stash, revert, or use a temporary worktree to confirm the test fails without the fix, every time.
  **Why:** a test written against a fix that's already in the file passes by construction. Without the failing-state proof, you have a confidence test, not a regression test — it cannot detect the bug coming back.

- **NEVER assert on internal call sequences or implementation details.**
  **Instead:** assert on the externally-observable outcome — return value, DB row state, HTTP response, rendered DOM, emitted event.
  **Why:** implementation-coupled tests pass for the wrong reasons and break on every refactor. The bug is observable; the test should be too.

- **NEVER loosen an assertion to make a failing test pass.**
  **Instead:** if the test fails after the fix, surface the discrepancy to the user. Either the fix is incomplete or the assertion is wrong — the user decides.
  **Why:** silently weakening the assertion is the exact failure mode that lets the bug return without anyone noticing. The test stops protecting against the very thing it was written for.

- **NEVER name the test after the fix.**
  **Instead:** name it after the bug's symptom (the wrong behavior, not the corrected one).
  **Why:** "normalizes slug case" tells the next reader nothing about what bug it pins; "returns 404 when slug contains uppercase letters" makes the regression obvious if the test ever fails again.

- **NEVER write a regression test for an unreproducible heisenbug.**
  **Instead:** stop and tell the user the bug needs a deterministic reproduction first; suggest adding logging or a feature flag to capture the failing input.
  **Why:** a flaky test pinning a flaky bug is twice the noise — the test will fail intermittently on CI for unrelated reasons and get muted, defeating its purpose.

- **NEVER bundle unrelated cleanup or "while I'm here" assertions into the regression test.**
  **Instead:** one test, one assertion, one bug. Other tests go in their own block.
  **Why:** if the file is later changed and the regression assertion fails, the developer needs to recognize *exactly* which behavior regressed. Mixed assertions make that ambiguous and erode trust in the test name.

- **NEVER mock the layer where the bug lived.**
  **Instead:** test the real code path that produced the bug. If the bug was in the data-access layer, hit the test DB; if it was in a handler, call the handler.
  **Why:** mocking the buggy layer means the test asserts your idea of how it works, not how it works. The original bug came from a mismatch between the two — the test must exercise the real thing.
