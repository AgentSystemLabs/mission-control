---
name: commit
description: Split the current working tree into one or more logically-grouped commits, ordered so each builds on its own (schema → backend → frontend; deps before consumers; types before usages). Runs a pre-flight quality gate (secrets scan, residue sweep, typecheck/lint per mode) before composing commits — production mode delegates to `check-pr-readiness` so the working tree is verified shippable before anything lands. Detects conventional-commits style from recent history, drafts messages per group, and asks the user to approve the grouping before creating any commit. Never pushes. Accepts `mode=fast|balanced|production` (default: `production`). Use when the user says "commit these changes", "commit by feature", "split this into commits", "/commit", or when `commit-and-push` delegates here. Skip for: empty trees, amend/fixup workflows, when the user has already staged a specific subset (assume that subset is one commit), or when the user wants the full publish pipeline (use `/commit-and-push` instead).
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# commit

Compose grouped commits from the working tree. Never push. Never amend. One run = one or more new commits, ordered to keep `HEAD` buildable at every step.

The bug class this skill exists to prevent: a single mega-commit of 50 unrelated files that no reviewer can grok, no bisect can isolate, and no `git revert` can cleanly undo. The other failure mode — silently committing a half-staged tree — is also out of scope here; this skill always inspects the **full** working tree before grouping.

---

## When to run vs. skip

Run when **any** is true:
- Working tree has uncommitted changes (staged or unstaged) and the user asked for a commit.
- `commit-and-push` invoked this skill as Step 1.

Skip and tell the user when **any** is true:
- Working tree is clean (`git status --porcelain` is empty) → "nothing to commit".
- The user is mid-rebase / mid-merge (`.git/MERGE_HEAD` or `.git/REBASE_HEAD` exists) → ask them to finish first.
- The user said "amend" or "fixup" — that's a different workflow; tell them to run `git commit --amend` or `git rebase -i` directly.

---

## Modes

Accepts `mode=fast|balanced|production`. Default — when no `mode=` is specified — is `production`. The mission of this skill: **code before commit must be good**. The default is strict on purpose; downgrade only when you know what you're skipping.

| Mode | Pre-flight (Step 0) |
|---|---|
| `fast` | Secrets scan + residue sweep only. Blocks on secrets, warns on residue. |
| `balanced` | `fast` + typecheck + lint on changed files. Blocks on type errors and lint errors. |
| `production` (default) | Full delegation to `check-pr-readiness` — typecheck, lint, formatter, test suite, residue sweep, large-file/lockfile checks — against the diff vs. base. Blocks on any red gate. |

**Override:** explicit `mode=fast|balanced|production` in the user's prompt always wins. When `commit-and-push` invokes this skill, the parent's mode is forwarded — do not re-prompt.

---

## Workflow

### Step 0 — Pre-flight quality gate

Run **before** any commit composition. The user said they want commits to be good; this is where that gets enforced.

**Always run (all modes):**

1. **Secrets scan — content, not just filenames.** Greps the full diff (`git diff HEAD` + untracked files about to be staged) for high-confidence patterns: AWS access keys (`AKIA[0-9A-Z]{16}`), generic API key shapes (`(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{16,}["']`), Stripe/Slack/GitHub tokens (`sk_live_`, `xox[bopas]-`, `ghp_`, `ghs_`, `gho_`), PEM blocks (`-----BEGIN .* PRIVATE KEY-----`), generic 32+ char hex/base64 assigned to a name containing `secret|key|token|password`. **Block** if any match — surface file:line, ask via `AskUserQuestion` to (a) abort so the user can scrub, (b) confirm the match is a false positive (test fixture, example, redacted placeholder).
2. **Secret-shaped filenames.** Already enumerated in Step 1 logic below (`.env*`, `*.key`, `*.pem`, `id_rsa*`, `credentials*`). Surface and default-exclude.
3. **Residue sweep — diff only.** Grep the staged + unstaged diff (not the whole repo) for:
   - `console.log` / `console.debug` / `dbg!` / `print(` in non-test source files (the project's logger if detected — keep it; raw `console.log` — flag it).
   - `.only(` / `.skip(` / `fit(` / `xit(` / `describe.only` / `test.only` in test files.
   - `debugger;` / `breakpoint()` statements.
   - New `TODO:` / `FIXME:` / `XXX:` lines added in this diff.
   - Merge-marker leftovers: `<<<<<<<`, `=======`, `>>>>>>>` (always a hard block).
   **Mode-dependent action:** `fast` warns and asks to proceed; `balanced` / `production` block on `.only` / `debugger` / merge-markers, warn on the rest.

**Mode `balanced` adds:**

4. **Typecheck on changed files** — detect via `package.json` scripts (`typecheck`, `type-check`, `tsc`) or by running `npx tsc --noEmit` if a `tsconfig.json` exists. For Python: `mypy` if configured. For Go: `go vet`. Block on any error introduced by the diff.
5. **Lint on changed files** — detect via `package.json` scripts (`lint`) or `eslint`/`biome`/`ruff`/`golangci-lint` configs. Run scoped to changed paths when the tool supports it. Block on errors; warn on warnings.

**Mode `production` (default) replaces 4–5 with:**

6. **Invoke `agentsystem-core:check-pr-readiness`** against `HEAD` vs. the base branch (or `HEAD` against an empty tree for the initial commit). Its full gauntlet — typecheck, lint, formatter, test suite, residue sweep, large-file additions, lockfile drift — runs. **Any red gate blocks Step 1.** Pipe its report through verbatim; do not summarize away failures.

**On block:** stop. Print the failing gate(s) with the exact reproduction command. Ask via `AskUserQuestion`:
- **Fix and re-run** → exit, let the user fix, re-invoke `/commit` to start fresh.
- **Downgrade mode** (only offered when invoked at `production`) → re-run Step 0 at `balanced`. Never offer downgrade past `balanced` for a known-failing gate.
- **Force-commit anyway** → require an explicit acknowledgement string. Record the bypassed gates in the commit body's trailer (`Bypassed-gates: typecheck, lint`). This is the escape hatch, not the default.

Once Step 0 is green (or explicitly bypassed), continue to Step 1.

---

### Step 1 — Inventory the working tree

```bash
git status --short
git diff --stat
git diff --cached --stat
```

Capture every changed file (added / modified / deleted / renamed), including untracked files the user clearly intends to commit (source files, configs, migrations). Treat as **excluded by default**: `.env*` (any extension), `.openai-key`, `*.key`, `*.pem`, `id_rsa*`, anything matching the project's `.gitignore`, build artifacts (`dist/`, `build/`, `.next/`, `node_modules/`).

If the working tree contains files matching a secret-shaped name (`.env`, `*.key`, `credentials*`), surface the list and ask via `AskUserQuestion` whether to include them. Default — **exclude**.

### Step 2 — Detect commit message style

Read the last 20 commits to detect house style:

```bash
git log -20 --pretty=format:'%s'
```

Decide:
- **Conventional commits** (`feat:`, `fix:`, `chore:`, `refactor:`, etc.) — if >50% of recent commits use this pattern.
- **Imperative-mood prose** (`Add X`, `Fix Y`, `Refactor Z`) — default fallback.
- **Project-specific prefix** (`[scope] ...`, `JIRA-123: ...`) — match what's there.

Stick to the detected style for every commit you propose. Do not introduce a new style.

### Step 3 — Propose grouping

Walk the changed files and propose 1–N commits. Each group should be:

- **Self-contained** — the commit, applied alone on top of `HEAD~1`, leaves the tree buildable (or at minimum, doesn't break a previously-green check).
- **Single-purpose** — answers one "what changed and why" question. If the message body would need bullet points to explain it, the commit is doing too much.

**Default ordering rules** (apply when files cross these layers):

1. **Schema / migrations first** — `migrations/`, `prisma/schema.prisma`, `src/db/schema.*`, `*.sql`. Migrations land before any code that depends on the new column/table.
2. **Backend / domain next** — `src/fn/`, `src/data-access/`, `src/use-cases/`, `src/server/`, `src/api/`, route handlers, server functions.
3. **Frontend last** — `src/routes/`, `src/components/`, `src/hooks/`, `src/queries/`, styles, assets.
4. **Tests with their target** — co-locate test changes with the production-code commit they cover, unless the user explicitly asked for a separate test commit.
5. **Configs / deps / lockfiles** — bundle into the commit that introduced the dependency or config need. Lone lockfile-only commits are noise.
6. **Doc-only changes** — separate commit at the **end** unless the doc is the migration notes for an above commit, in which case bundle it.

**When in doubt, fewer commits.** Three commits with clear stories beats six commits split on file-path heuristics.

**For dirty trees with both feature work AND unrelated drive-by edits** (e.g., the user fixed a typo while building a feature), surface the unrelated edits in their own group and ask via `AskUserQuestion` whether to keep them in this batch or stash them for later. Don't silently bundle.

### Step 4 — Draft messages

For each proposed commit:

- **Subject line** — ≤72 chars, imperative mood, matches detected style (Step 2). State the "what" (one phrase) — not the "why" (that's the body, if needed).
  - Conventional: `feat(scope): add stripe webhook handler` or `refactor: extract auth middleware`.
  - Prose: `Add stripe webhook handler` or `Extract auth middleware`.
- **Body** — only when the "why" or "how" is non-obvious to a reader six months from now. Bullet points are fine; paragraphs better. Cap ~5 lines. Skip the body entirely for cosmetic / typo / formatting commits.
- **Trailers** — match what the repo already uses (`Co-Authored-By:`, `Signed-off-by:`, `Refs: #123`). Do not invent new trailers.

**Never inflate trivial commits with paragraphs of body text.** A `fix(ui): typo in onboarding header` does not need a 4-line body explaining what a typo is.

### Step 5 — Show the plan and get approval

Print exactly:

```
Proposed commits (in order):

  1. feat(db): add `webhook_event` table for stripe idempotency
     • migrations/0042_webhook_event.sql
     • src/db/schema.ts

  2. feat(api): add stripe webhook handler
     • src/fn/stripe-webhook.ts
     • src/lib/stripe-client.ts

  3. test: cover stripe webhook idempotency
     • src/fn/stripe-webhook.test.ts

  4. docs: note STRIPE_WEBHOOK_SECRET in .env.example
     • .env.example
     • README.md
```

Then ask via `AskUserQuestion`: "Proceed with this commit plan?" — options:
- **Yes** → run Step 6.
- **Edit** → ask which group to change (re-group / re-message / split / merge / drop) and loop back to Step 5.
- **Cancel** → exit without committing anything. Working tree is untouched.

### Step 6 — Create the commits

For each group, in order:

```bash
git add -- <file1> <file2> ...           # explicit paths only; never `git add .` or `-A`
git commit -m "$(cat <<'EOF'
<subject>

<body — only if Step 4 had one>
EOF
)"
```

After each commit, re-check `git status` to confirm the staged set landed and the next group's files are still there. If any group fails to apply cleanly (merge marker leftover, pre-commit hook rejects), stop, surface the error verbatim, and ask the user how to proceed. Do not auto-`--no-verify`.

### Step 7 — Report

One-line summary per commit:

```
✔ <sha-short>  feat(db): add `webhook_event` table for stripe idempotency
✔ <sha-short>  feat(api): add stripe webhook handler
✔ <sha-short>  test: cover stripe webhook idempotency
✔ <sha-short>  docs: note STRIPE_WEBHOOK_SECRET in .env.example

4 commits created on <branch>. Working tree is clean.
```

If invoked by `commit-and-push`, hand control back. Otherwise stop — this skill does not push.

---

## NEVER

- **NEVER `git add .` or `git add -A`**
  **Instead:** Stage explicit paths per group (`git add -- path/to/file …`).
  **Why:** Both forms sweep in untracked files the user didn't intend — `.env`, `.openai-key`, `id_rsa`, a stray `tmp.txt`. Even one unintended secret committed once is a credential rotation, a force-push to remove, and a postmortem.

- **NEVER bundle a secret-shaped file (`.env*`, `*.key`, `id_rsa*`, `credentials*`) without explicit confirmation**
  **Instead:** Surface the list at Step 1 and ask. Default exclude.
  **Why:** Secrets in git history persist forever; the cost of one bad commit dwarfs the friction of one extra prompt.

- **NEVER amend, fixup, or rewrite existing commits**
  **Instead:** Always create new commits on top of `HEAD`. If the user wants amend/fixup, tell them to run `git commit --amend` or `git rebase -i` directly and exit.
  **Why:** Amend/rewrite is an irreversible operation when the branch has been shared. This skill is "one run = one or more new commits," nothing else.

- **NEVER `--no-verify` to bypass a failing pre-commit hook**
  **Instead:** Surface the hook's output, stop, and ask the user how to proceed (fix the issue, skip this group, abort).
  **Why:** Hooks exist for a reason the user set up. Bypassing them silently produces commits that fail CI on the very next push.

- **NEVER push or open a PR**
  **Instead:** Stop after Step 7. Tell the user to run `/commit-and-push` or `/open-pr` next if they want.
  **Why:** Commit composition and publish-to-remote run on different cadences. The user invoked this skill to commit — letting it push would surprise them on shared branches.

- **NEVER reorder groups in a way that breaks `HEAD` mid-sequence**
  **Instead:** Apply the Step 3 ordering rules — schema before consumers, types before usages, deps before lockfile entries. If two groups must land together to keep `HEAD` green, merge them into one commit.
  **Why:** A commit that fails to typecheck or build on its own poisons `git bisect` and `git revert <one-commit>` for everyone after you.

- **NEVER invent a new commit-message style**
  **Instead:** Detect style from the last 20 commits (Step 2) and match it. If the repo is empty, default to plain imperative prose.
  **Why:** Tooling (changelog generators, release scripts, GitHub squash rules) usually parses one specific style. A drive-by switch from `feat:` to `Add ...` breaks the toolchain silently.

- **NEVER skip Step 0 to "save time" or because the user seems in a hurry**
  **Instead:** Run the pre-flight at whatever mode was requested (default `production`). If the user wants speed, they can pass `mode=fast` — that's a documented downgrade, not an unspoken one.
  **Why:** The whole point of this skill's redesign is that commits go in clean. Quietly skipping the gate puts broken code in `HEAD` and defeats the mission.

- **NEVER record a bypassed gate without the `Bypassed-gates:` trailer**
  **Instead:** When the user picks "force-commit anyway" at Step 0, append a `Bypassed-gates: <list>` trailer to the commit body so future blame/`git log` shows that this commit ducked a red gate.
  **Why:** Bypasses are sometimes necessary (broken upstream, emergency patch); silent bypasses are not. The trailer is the audit trail.

- **NEVER claim "nothing to commit" without checking untracked files too**
  **Instead:** `git status --porcelain` reports both tracked changes and untracked files. If there are untracked source files the user clearly meant to ship, treat them as a candidate group.
  **Why:** A user who just wrote a new file and runs `/commit` does not expect "nothing to commit" — they expect the new file to be staged.
