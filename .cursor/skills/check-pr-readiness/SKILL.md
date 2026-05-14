---
name: check-pr-readiness
description: Pre-PR gauntlet — run the project's typecheck, linter, formatter, and test suite against the branch's diff vs. the base, plus a residue sweep for `console.log`, `.only` / `.skip`, debugger statements, leftover TODOs in changed files, dropped lockfiles, and unintended large/binary additions. Reports each gate's pass/fail with the exact reproduction command. Auto-fixes only the format-and-lint-fix gate when it has a known auto-fix; everything else is reported, never silently fixed. Trigger phrases — "pre-pr check", "ready to PR?", "is this PRable", "pre-flight this branch", "gauntlet", "/check-pr-readiness", "lint+test+types before PR". Skip for — branches with no commits beyond base, doc-only or comment-only diffs (still useful but optional), repos with no CI conventions to enforce.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Check PR Readiness

A pre-flight gate for code that is about to go on a pull request. Each check has one exit condition: **green** or **report-and-stop**. Do not run the next check if the previous fails — surface the failure first.

---

## Phase 1 — Scope the Diff

Determine the branch range:

- Base = `git merge-base HEAD origin/$(git rev-parse --abbrev-ref origin/HEAD | sed 's@^origin/@@')` if origin/HEAD is set; else `origin/main`; else the user-specified base.
- Changed files = `git diff --name-only <base>...HEAD` plus `git status --porcelain` for unstaged/untracked.

If the changed-file list is empty, stop: "No changes against base — nothing to check."

**Exit:** the file list and the base ref are fixed.

---

## Phase 2 — Detect Project Tooling

Read `package.json` (or `pyproject.toml` / `Cargo.toml` / `go.mod` for non-JS) to find the actual scripts. Do not guess command names. Map to:

| Gate | Detection (in order) |
|---|---|
| typecheck | `package.json` script `typecheck` / `check-types` / `tsc`; else `npx tsc --noEmit` |
| lint | script `lint` / `lint:check`; else local config presence (`eslint.config.*`, `.eslintrc*`) → `npx eslint <changed-files>` |
| format | script `format:check` / `prettier:check`; else `npx prettier --check <changed-files>` if `.prettierrc*` exists |
| test | script `test` / `test:unit` / `test:run`; for vitest, prefer `vitest run --changed <base>` |
| build | script `build` (only if user asks for full readiness; otherwise skip) |

Report what was detected. If a gate has no tooling, mark it `n/a` and continue — do not invent a checker.

**Exit:** every gate has a concrete command or `n/a`.

---

## Phase 3 — Run the Gauntlet

Run each detected gate in this order. Stop at the first failure and report; do not auto-fix code (except in Phase 4 below for format).

1. typecheck
2. lint
3. format
4. test
5. residue sweep (Phase 5)

For each: print the command, run it, capture exit code + last 30 lines of output on failure.

```
[✓] typecheck          (npx tsc --noEmit)                — clean
[✗] lint               (pnpm lint)                        — 3 errors in src/foo.ts
    src/foo.ts:14: 'unused' is defined but never used
    ...
```

If a gate fails, stop the gauntlet and produce a final report with: the exact reproduction command, the failing files/lines, and the suggested fix path (run the auto-fix script for lint/format; otherwise the user fixes).

**Exit:** all gates green, or one is red and reported.

---

## Phase 4 — Auto-Fix Gate (Format/Lint Only)

If `format` failed and a `format` (write) script exists (`format`, `prettier:write`, `lint:fix` for stylistic-only rules), offer to run it:

```
Format check failed. Auto-fix available: pnpm format
Apply? (y/n)
```

Wait for `y`. After running, re-run the format check. Do not auto-fix lint errors that aren't pure stylistic — they often encode real bugs.

**Exit:** format gate is green, or user declined auto-fix.

---

## Phase 5 — Residue Sweep

`git diff <base>...HEAD` filtered to source files (exclude `*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, generated dirs). Search the **added** lines only (not the whole file) for:

- `console.log`, `console.debug`, `console.dir` (allow `console.error` / `console.warn` if the project uses them)
- `debugger;`
- `.only(` and `.skip(` in test files
- `// TODO` / `// FIXME` / `// XXX` newly added in this branch
- `it.todo(` left in
- Large file additions (> 500 KB) and binary files not under `assets/` or `public/`
- Lockfile changed without a `package.json` change (suggests stale resolve)
- `package.json` `dependencies` / `devDependencies` change without a lockfile change

Report each hit with file:line. Do not delete — these are intentional sometimes (e.g., `console.error` for genuine error logging).

**Exit:** residue list is reported.

---

## Phase 6 — Final Report

```
PR Readiness — <branch> vs <base>
─────────────────────────────────
typecheck   ✓
lint        ✓
format      ✓
test        ✓ (87 passed, 0 failed)
residue     ⚠ 2 console.log in src/foo.ts:14, src/foo.ts:88
            ⚠ TODO added: src/bar.ts:21

Verdict: READY (with residue warnings)
```

Verdict is `READY` only when all gates are ✓ and residue is empty or all warnings explicitly acknowledged. Otherwise: `BLOCKED` with the failing gate.

---

## NEVER

- **NEVER auto-fix lint or test failures.**
  **Instead:** report the failure with the exact command to reproduce. Auto-fix only format issues, and only after user `y`.
  **Why:** lint rules often catch real bugs (unused vars, missing deps in hooks). Auto-fixing them masks the bug; the fix should be made deliberately so the developer sees what changed and why.

- **NEVER continue the gauntlet after the first failure.**
  **Instead:** stop, report, let the user fix and re-run.
  **Why:** later gates often produce noise that's caused by the earlier failure (a typecheck failure cascades into test failures). Running them adds zero signal and wastes minutes.

- **NEVER invent commands the project doesn't define.**
  **Instead:** if no `lint` script and no eslint config exists, mark lint `n/a` and skip.
  **Why:** running an arbitrary linter on a project that doesn't use one produces a flood of irrelevant errors and trains the user to ignore the gauntlet.

- **NEVER scan the whole file for residue patterns.**
  **Instead:** scan only added lines in the diff (`git diff <base>...HEAD` → lines starting with `+`).
  **Why:** existing `console.log`s in the file aren't this branch's responsibility. Reporting them dilutes the signal and produces alert fatigue.

- **NEVER strip `console.error` / `console.warn` from the residue allowlist without checking the project's logging conventions.**
  **Instead:** allow them by default; if the project uses a structured logger and forbids `console.*`, treat all `console` calls as residue.
  **Why:** many projects intentionally use `console.error` as the error path. Flagging it manufactures false positives.

- **NEVER push or open a PR from this skill.**
  **Instead:** report the verdict and stop. The user invokes the PR-creation skill separately when they're ready.
  **Why:** this is a gate, not a workflow step. Coupling it to push/PR conflates "checked" with "ready", and a developer often wants to see the report before deciding.
