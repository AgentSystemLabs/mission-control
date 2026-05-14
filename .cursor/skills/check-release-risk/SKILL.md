---
name: check-release-risk
user-invocable: false
metadata:
  audience: handoff
description: Final pre-publish handoff invoked by commit-and-push, open-pr, and release skills. Summarizes what changed on the branch and what could break in production — public API surface changes, persistence shape changes, auth/payment/permission changes, new env vars or operational setup, manual-QA-needed paths, doc/changelog/migration-notes deltas, and rollback concerns. Reads git log + diff vs. the base branch; categorizes each change by risk; produces a concise risk briefing the user reads BEFORE pushing or opening a PR. Does NOT block — informs. Trigger phrases for routing: "release risk", "what could break", "pre-publish check", "ship summary", "what's risky in this branch", "check before push". Skip for branches with zero diff vs. base, doc-only branches, comment-only branches.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Code Check Release Risk

A pre-publish risk briefing. Reads the branch's full diff vs. the base, classifies the changes, and produces a concise summary the user sees BEFORE the irreversible step (push, PR, release tag). Sibling to `check-pr-readiness` (which runs typecheck/tests/lint); this skill is **content** review, not gate review.

This skill informs; it does not block.

---

## When to run

Run when **any** is true:
- The user invoked `/commit-and-push`, `/open-pr`, or `/release`.
- The user says: "what could break", "release risk", "pre-publish check", "anything risky", "summarize this branch".

**Do NOT run** for: branches with zero diff vs. base, doc-only branches, comment/format-only branches.

---

## Workflow

### Step 1 — Determine base branch and gather the diff

```bash
# Resolve base branch
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
# Fallback: main → master → develop
```

```bash
git rev-parse --abbrev-ref HEAD
git log --oneline <base>..HEAD
git diff --stat <base>..HEAD
git diff --name-status <base>..HEAD
```

Capture: branch name, commit count, files changed, lines added/removed.

### Step 2 — Run seven categorizers

Each categorizer scans the diff and labels matching findings into one of these buckets. A finding can land in multiple buckets.

#### Categorizer 1 — Public API surface change

```bash
git diff <base>..HEAD -- 'src/fn/**' 'src/api/**' 'src/routes/api/**' 'app/api/**' 'src/trpc/**'
```

Look for: added/removed/renamed exports, changed function signatures, changed return types, changed input schemas. Each is a **breaking-or-compatible** change for callers — note which.

#### Categorizer 2 — Persistence shape change

```bash
git diff <base>..HEAD -- 'src/db/**' 'prisma/**' 'migrations/**' '*.sql'
```

Look for: new migrations, schema field add/remove/rename, type changes, constraint changes. Tag any **destructive** migration (DROP COLUMN, DROP TABLE, NOT NULL on populated table) as **HIGH risk**.

#### Categorizer 3 — Auth / payment / permission change

```bash
git diff <base>..HEAD | rg -E '(auth|session|jwt|cookie|password|stripe|payment|billing|permission|role|policy)'
```

Manually classify hits. Auth changes are **HIGH risk** by default — they're the easiest place to introduce a regression that the typechecker won't catch.

#### Categorizer 4 — New env vars or operational setup

```bash
# .env.example diff
git diff <base>..HEAD -- '.env.example' '.env.sample' 'env.example.ts'
# process.env reads in new code
git diff <base>..HEAD | rg '^\+.*process\.env\.'
```

For each new env var: check if `.env.example` was updated. If not: **MEDIUM** — the deploy will break with a missing-env error in prod.

#### Categorizer 5 — Manual-QA-needed paths

Manually classify changes touching:
- File upload/download.
- Email/SMS sending.
- External webhook receiving.
- Multi-step user flows (signup, checkout, onboarding).
- Background jobs / cron.

These can't be fully covered by unit tests. Tag with the recommended QA step.

#### Categorizer 6 — Doc / changelog / migration-notes drift

```bash
# Did docs change?
git diff <base>..HEAD --name-only | rg -E '\.(md|mdx)$'
# Did CHANGELOG change?
git diff <base>..HEAD -- 'CHANGELOG.md'
```

If the branch has user-facing changes (categorizer 1, 3, or 5 hits) but no doc/changelog edits: **MEDIUM** — recommend running `/sync-docs` and `/update-changelog` before publishing.

#### Categorizer 7 — Rollback concerns

For each finding from categorizers 1–4, ask: "If this ships and breaks production, can we revert?"
- Code-only change → revert is clean.
- Migration change → revert may not roll back data; tag **HIGH**.
- Auth/session change → may invalidate active sessions on rollback; tag **MEDIUM**.
- Env var added → revert needs coordination with deployment to remove the var; tag **LOW**.

### Step 3 — Report

```
## Release risk briefing — <branch> → <base>

**Commits:** <N>   **Files:** <M>   **+<adds>/-<dels>**
**Overall risk:** <LOW | MEDIUM | HIGH>

### HIGH risk
- **Auth flow changed** — <commit-sha> (<file>:<line>)
  - <one-line description>
  - Risk: silent session invalidation on rollback.
  - Recommended: manual QA on login/logout/refresh; canary if available.

- **Destructive migration** — <commit-sha> (`migrations/<file>`)
  - DROP COLUMN `<table>.<col>`.
  - Risk: irreversible without DB backup.
  - Recommended: verify backup exists; confirm no production code reads the column.

### MEDIUM risk
- **New env var: `<NAME>`** — `.env.example` not updated.
  - Recommended: add to `.env.example` and any deployment templates before merge.

- **Public API rename: `<oldFn>` → `<newFn>`** — <file>:<line>
  - 4 callers updated in this branch; verify external consumers (other repos/services) are aware.

- **Webhook handler added** — `<file>:<line>`
  - Recommended: manual QA — fire a test event after deploy.

### LOW risk
- **Doc drift:** README mentions removed feature `<X>`.
- **No CHANGELOG entry** for user-visible changes — consider running `/update-changelog`.

### Operational notes
- New env vars: <NAME1>, <NAME2>
- New external dependencies: <dep1>, <dep2>
- Migrations to run on deploy: <count>
- Recommended deploy order: <code → migrate → code, OR migrate → code, OR code-only>

### Rollback notes
- Code-only commits revert cleanly.
- Migration `<file>` is destructive — requires DB backup before rollback.

---

No release risks detected — branch is low-risk.    ← only if 0 findings
```

After producing the report, end with:

```
This is informational. Proceed when ready:
  • /commit-and-push
  • /open-pr
  • /release
```

---

## NEVER

- **NEVER block the user from publishing**
  **Instead:** Report risks and let the user decide. The skill is informational; the publish path remains the user's call.
  **Why:** Mandatory gates that the user can't bypass break the trust contract — the user invoked /commit-and-push, not /risk-veto. They want a heads-up, not a blocker.

- **NEVER auto-fix issues identified in the briefing**
  **Instead:** Recommend the relevant skill (`/sync-docs`, `/update-changelog`, or the `reviewer-data-integrity` subagent) and let the user run it.
  **Why:** The user is at the publish boundary; auto-edits at this point delay the publish they explicitly asked for and produce a moving diff under their feet.

- **NEVER scan beyond the branch's diff vs. base**
  **Instead:** Use `git diff <base>..HEAD` exclusively. Do not include uncommitted work or unrelated history.
  **Why:** The publish action targets the branch's commits; including uncommitted work double-counts changes that aren't being shipped, and including older history confuses the picture.

- **NEVER classify a renamed-only public function as low-risk**
  **Instead:** Renames are HIGH for external consumers and MEDIUM for in-repo callers (the type checker catches in-repo). Always note "external consumers must be checked separately."
  **Why:** Renames pass typecheck and tests in the repo but break downstream consumers (other apps, external integrations, generated clients) silently.

- **NEVER assume the base branch is `main`**
  **Instead:** Resolve `origin/HEAD` first; fall back to `main` → `master` → `develop`. If still unresolved, ask once.
  **Why:** A wrong base produces a wrong diff, which produces a wrong briefing — the entire output becomes misleading.

- **NEVER duplicate `check-pr-readiness`'s gates**
  **Instead:** Stay focused on **content** risk (what changed and what could break). Typecheck, lint, format, test results belong to `check-pr-readiness`.
  **Why:** Two skills running the same expensive gates wastes the user's pre-publish budget; each skill earns its slot by doing one thing well.
