---
name: write-tests
user-invocable: false
metadata:
  audience: handoff
description: Internal handoff target invoked as Phase 8 of add-feature and as the test step for modify-feature and realign — and any time a feature lands without a test step. Stack-agnostic phased workflow for adding or expanding an automated test suite for a chosen module. Detects existing test harness (Vitest/Jest/Playwright/pytest/go test/cargo test/RSpec/JUnit) via config files, lockfile, and scripts; if absent, proposes the smallest industry-standard runner for the stack and waits for user approval before installing. Wires ONE smoke test that must pass before generating the rest, inherits naming/mocking conventions from existing tests, and defaults to a real test DB with mocks only at third-party API boundaries. Trigger phrases for routing: "write tests", "add tests for X", "expand the test suite", "cover this with tests". Skip for pure type-only refactors with no behavior change, single-line copy edits, generated files, and projects where the user explicitly says "no tests".
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Code Write Tests

Phased workflow. Each phase has a hard exit condition — do not proceed until it's met.

---

## Phase 1 — Scope

Confirm the target file/module and the specific behaviors that must be covered (happy path only, or edge + error paths). Read the target — its public surface (exported functions, routes, classes, side effects) is what tests will assert against.

**Exit:** target file path is known and read.

---

## Phase 2 — Detect Harness

**MANDATORY — READ [`references/harness-detection.md`](references/harness-detection.md)** before deciding.

Apply the precedence rules from that file. Report findings:

```
Harness detected: <name> (or: none)
Evidence: <config file path / lockfile entry / script>
Test file convention: <colocated *.test.ts / __tests__/ / tests/ / *_test.go / etc.>
```

**Exit:** harness is either confirmed present, or confirmed absent.

If a harness was detected, do **NOT** load `references/runners-by-stack.md` — Phase 3 is skipped.

---

## Phase 3 — Propose Runner (only if no harness)

If a harness was found, skip to Phase 4.

Otherwise, **MANDATORY — READ [`references/runners-by-stack.md`](references/runners-by-stack.md)** to pick the smallest industry-standard runner for the detected stack.

Present to the user:

```
No test harness detected.
Stack: <node+ts / python / go / rust / ruby / java / ...>
Proposed runner: <name>
Install command: <exact command, copy-pasteable>
Config additions: <files that will be created / edited>
```

Ask: `Approve install? (y/n)`.

- **NEVER auto-install.** Wait for explicit `y`.
- If `n`, ask the user to name the runner they want, or stop.
- Only propose runners listed in `runners-by-stack.md`. Do not invent or suggest niche tools.

**Exit:** user approved an install, OR user named an alternative runner. Run the install. Verify it succeeds.

---

## Phase 4 — Inherit Conventions

If existing tests are present, read 1–2 of them (pick recently-modified ones near the target). Extract:
- File location + naming pattern
- Assertion style (e.g., `expect().toBe()` vs `assert.equal`)
- Fixture / setup pattern (`beforeEach`, fixtures dir, factories)
- Mock policy (real DB? in-memory? mocks at boundary?)

If no existing tests, defaults:
- File location: colocated `<name>.test.<ext>` next to the source file (use stack idiom if different — see `runners-by-stack.md`).
- Mocks: **real test DB; do not stub internal calls**. Only mock at third-party API boundaries that require real auth keys (Stripe, OAuth, OpenAI, etc.).
- Fixtures: inline factory functions until duplication justifies extraction.

**Exit:** convention notes written down (in your working memory or a scratch comment) — applied to every test you generate next.

---

## Phase 5 — Smoke Test (HARD GATE)

Write **one** trivial test against the target module — the simplest possible passing assertion (e.g., the module exports the expected symbol; one happy-path call returns the expected shape).

Run the test runner. It must pass.

- If it fails: **stop**. Debug the harness wiring, path, import, config. Do not write more tests.
- If it passes: proceed.

This gate exists because piling on 20 tests against a misconfigured runner produces 20 false negatives or 20 false positives. One green smoke test proves the loop closes.

**Exit:** one test exists and passes when the runner is invoked.

---

## Phase 6 — Generate Suite

Before each test, ask: **what is the externally observable contract — return value, DB row, emitted event, HTTP response — that proves this works?** Assert that, not the call sequence.

For each item on the target module's public surface, write:
1. **Happy path** — typical input, expected output / side effect.
2. **Edge cases** — boundaries (empty, max, null/undefined where allowed, unicode, large input).
3. **Error paths** — invalid input, downstream failure, auth/permission denial.

Skip combinations that produce duplicate assertions. Prefer behavioral assertions (the function returned the right value, the DB row was created, the email was queued) over structural ones (snapshot of an object).

**MANDATORY — READ [`references/test-patterns.md`](references/test-patterns.md)** if unsure how to assert a particular behavior in the chosen runner.

Run the full suite. Every test must pass. If a test fails because the implementation is wrong (not the test), surface it to the user — do not silently fix the test to match.

**Exit:** all generated tests pass.

### Report

After the suite is green, tell the user the files added/edited, counts by category, and the command to run the suite. **Name each third-party boundary you mocked** so the user can decide whether a real integration test is owed.

---

## NEVER

- **NEVER auto-install a test runner.**
  **Instead:** propose the install command, wait for `y`, then run it.
  **Why:** dependency installs change lockfiles, package manifests, and CI surface area. Silent installs surprise the user and pollute repos with runners they didn't choose.

- **NEVER skip the Phase 5 smoke gate.**
  **Instead:** write one trivial passing test and run it before generating the rest.
  **Why:** a misconfigured runner produces tests that pass when they shouldn't or fail when they shouldn't. Ten green tests on a broken harness is worse than one — it manufactures false confidence.

- **NEVER add a second harness alongside an existing one.**
  **Instead:** use whatever Phase 2 detected. If the user wants to migrate, that's a separate task.
  **Why:** dual runners split the suite, double the CI time, and create gaps where each side assumes the other ran.

- **NEVER write tautological tests that mirror the implementation.**
  **Instead:** assert the externally observable contract (return value, DB row, emitted event, HTTP response) — not the internal call sequence.
  **Why:** tests that copy the implementation pass for the wrong reasons and break on every refactor without catching real bugs.

- **NEVER mock the database or internal modules by default.**
  **Instead:** use a real test DB; mock only at third-party API boundaries that require real auth (Stripe, OpenAI, OAuth).
  **Why:** mocked-DB tests passed last quarter while the prod migration broke — divergence between mock and real behavior is the failure mode this skill is designed to prevent.

- **NEVER snapshot-spam.**
  **Instead:** write behavioral assertions. Use snapshots only if the project already does and only for stable, human-reviewable output.
  **Why:** snapshot tests rot — they get blindly regenerated on failure and stop catching regressions.

- **NEVER edit a failing test to make it pass when the implementation is the bug.**
  **Instead:** stop, surface the discrepancy to the user, let them decide.
  **Why:** the whole point of writing tests after the fact is to catch latent bugs. Hiding them defeats the exercise.

- **NEVER fix unrelated bugs you discover while writing tests in the same change.**
  **Instead:** surface the bug to the user; either land tests-first that document current behavior with a `// FIXME` reference, or pause and fix it as a separate change.
  **Why:** mixing "add tests" and "fix bugs" makes it impossible to tell from the diff which behavior is intended vs. legacy, and it breaks bisect when a regression appears later.
