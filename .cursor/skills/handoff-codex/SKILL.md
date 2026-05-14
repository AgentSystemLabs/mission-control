---
name: handoff-codex
description: Hand off a stalled task or stubborn bug to the OpenAI Codex CLI for a second pass — package the original request, what Claude tried, and the live `git status` + `git diff` into a prompt file, then fire `codex exec` headless at high reasoning effort against codex's latest configured model, wait, and verify what changed. Trigger phrases — "/handoff-codex", "hand off to codex", "debug with codex", "finish off using codex", "let codex try", "codex it". Use when stuck after multiple attempts or to get a second model's pass on a hard bug. Skip for — first-pass fresh tasks, tasks needing mid-flight user input (codex exec is one-shot), or when `codex` is not on PATH.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# handoff-codex

Hand off the current task to `codex exec` (OpenAI Codex CLI) when Claude is stuck or wants a second pass. Fire-wait-verify, not fire-and-forget.

The user is delegating because *the existing approach didn't work* — so the value of this skill is in the **handoff packet**: the original goal, what was tried, what failed, and the exact diff Claude has produced so far. A thin packet wastes the codex run.

---

## When NOT to run

- First-pass attempts on a fresh task — try yourself before delegating.
- Tasks where you don't yet know what to ask for. Clarify with the user first; don't punt ambiguity to codex.
- When `codex` is not on PATH (run `command -v codex` to verify before doing anything else).

---

## Workflow

### Step 1 — Preflight

Run these checks. If any fail, stop and tell the user.

1. `command -v codex` — codex CLI must exist. If missing, instruct the user to install it (`npm i -g @openai/codex` or equivalent) and abort.
2. `git rev-parse --is-inside-work-tree` — note whether we're in a git repo. If not, set a flag to add `--skip-git-repo-check` later and skip the diff/status capture.
3. `git status --short` and `git diff` — capture **right now**, not from earlier in the session. Stale diffs are worse than no diffs.

### Step 2 — Build the handoff packet

Write the full prompt to `/tmp/codex-handoff-prompt.md` (use the `Write` tool). Argv has length limits; piping a file via stdin does not.

Required sections, in this order:

```markdown
# Task handoff from Claude Code

## Original request
[verbatim or close paraphrase of what the user asked for]

## What I tried
[bullet list — each attempt + what happened. Include error messages verbatim.]

## Where I got stuck
[the specific blocker, in one paragraph. Be honest about what you don't understand.]

## Files I touched
[list with one-line summary per file]

## Current `git status`
```
[paste output]
```

## Current `git diff`
```
[paste output — truncate to ~500 lines if huge, and say so]
```

## What I need from you
[concrete ask — "finish wiring X to Y", "find why Z silently fails", "get the test in foo.test.ts to pass"]
```

If the diff is enormous (>1000 lines), include a summary plus the most relevant hunks rather than raw output.

### Step 3 — Invoke `codex exec` headless at high reasoning effort

Do not pin a specific model version. `codex exec` defaults to the latest model the user's installation is configured for — that's the right one to use, because OpenAI's model lineup evolves faster than this skill can. Pass `-c model_reasoning_effort=high` so codex spends extra reasoning budget on the hard problem you're handing off (this is the whole point of delegating — you wouldn't be calling codex if the task were easy).

**User override** — if the user explicitly named a model in their prompt ("hand off to codex with o4-mini"), honor that with `--model <name>`. Otherwise omit `--model` entirely and let codex pick its default.

Use the `Bash` tool with **`timeout: 600000`** (10 minutes — codex runs are not 2-minute jobs):

```bash
codex exec \
  -c model_reasoning_effort=high \
  --sandbox workspace-write \
  --ask-for-approval never \
  -o /tmp/codex-output.md \
  - < /tmp/codex-handoff-prompt.md
```

Add `--skip-git-repo-check` if preflight flagged non-repo. Add `--model <name>` only when the user named one.

The trailing `-` reads the prompt from stdin. The `-o` flag writes codex's final message to a file for clean parsing (stdout also gets it; stderr has progress noise).

**Failures** — surface the exit code and stderr to the user verbatim. Do not retry blindly. The most common failures are auth (codex not signed in), billing (quota exhausted), and CLI flag drift (a `-c` key or flag was renamed in a newer codex release). Each requires a user decision, not an automatic retry.

**Note on CLI flag drift** — `codex exec` flags and config keys evolve with the `@openai/codex` releases. If a flag or `-c key=value` is rejected as unknown, surface the error verbatim (don't silently strip it) and ask the user to upgrade `@openai/codex` or adjust the invocation. The flag set documented here matches the CLI as published; pin nothing else.

### Step 4 — Verify

After codex returns:

1. Re-run `git status --short` and `git diff --stat` to see what codex actually changed.
2. Read `/tmp/codex-output.md` — codex's final message explaining what it did.
3. Cross-check: did codex's claimed changes match the actual diff? If codex says "I fixed X" but the diff doesn't touch the relevant file, flag it.
4. Summarize for the user: what codex changed, whether it looks like the original ask is satisfied, and any concerns.

**If the Bash call hits the 10-min timeout** — report it explicitly, surface stderr, and do not retry automatically. The user decides whether to re-invoke with a tighter prompt or a different model.

**If `/tmp/codex-output.md` is empty or missing after a zero exit code** — treat the run as failed. Surface the captured stderr, do not assume codex did the work silently.

**Do NOT commit.** Staging and commit decisions stay with the user.

---

## NEVER

- **NEVER pass the handoff prompt as a shell argument** (`codex exec "huge prompt..."`)
  **Instead:** Write to a file, pipe via stdin (`codex exec ... - < file`).
  **Why:** Argv length limits truncate large prompts silently on macOS/Linux; the diff section is the first thing to get cut.

- **NEVER run codex with `--ask-for-approval` set to anything except `never`**
  **Instead:** Always use `--ask-for-approval never` for headless invocation.
  **Why:** Any other value can block waiting for an interactive approval that will never arrive — your Bash call hangs until the 10-minute timeout.

- **NEVER auto-commit or push codex's changes**
  **Instead:** Report what changed; let the user stage and commit.
  **Why:** Codex sometimes "fixes" the wrong file or makes confident-sounding changes that miss the real bug. The user is the reviewer.

- **NEVER skip the live `git status` + `git diff` capture in Step 1**
  **Instead:** Capture immediately before writing the prompt file, even if you ran them earlier in the session.
  **Why:** Codex starts from a cold context; without the current diff, it edits files Claude already modified and clobbers in-progress work.

- **NEVER pin a specific model version in this skill**
  **Instead:** Omit `--model` and let codex use its configured default (the latest the user's install supports). Only pass `--model <name>` when the user named one in their prompt.
  **Why:** OpenAI's model lineup turns over faster than this skill is updated. A pinned model goes stale in months; the user's codex install always knows the current default. Hard-coding here just produces broken runs after the next OpenAI release.

- **NEVER drop `-c model_reasoning_effort=high`**
  **Instead:** Always pass it. If the user wants a cheaper run, they'll say so.
  **Why:** The whole reason to invoke this skill is that Claude is stuck on a hard problem. Handing it off without high effort wastes the round-trip — you'd get the same shallow answer Claude already produced.

- **NEVER report success based on codex's final message alone**
  **Instead:** Cross-check codex's claimed changes against the actual `git diff`. If codex says "I fixed X in foo.ts" but the diff doesn't touch foo.ts, treat the run as failed.
  **Why:** Codex sometimes hallucinates edits — its final message describes what it intended to do, not what landed on disk.

- **NEVER invoke this skill proactively**
  **Instead:** Wait for an explicit trigger phrase ("hand off to codex", "/handoff-codex", etc.).
  **Why:** Claude reaching for codex on its own circumvents the user's judgment about when delegation is warranted and burns API credits without consent.

---

## Reference — `codex exec` flags used

| Flag | Why |
|------|-----|
| `-c model_reasoning_effort=high` | Forces high reasoning effort — this skill exists for hard problems, so spend the budget |
| `--model <name>` | Omitted by default (codex picks its latest). Pass only when the user explicitly named a model |
| `--sandbox workspace-write` | Lets codex edit files in cwd; blocks system-wide writes |
| `--ask-for-approval never` | Mandatory for headless |
| `-o <path>` | Final message → file for parsing |
| `-` | Read prompt from stdin |
| `--skip-git-repo-check` | Only when not in a git repo |
