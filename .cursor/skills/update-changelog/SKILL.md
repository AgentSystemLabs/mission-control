---
name: update-changelog
description: Append a new entry to the project's CHANGELOG.md after finishing a feature, fixing a bug, tuning performance, applying a security patch, or before a commit. One chronological markdown file (newest first), bullet points prefixed with a category emoji, concise user-perspective wording. Trigger phrases — "update changelog", "/changelog", "log this change", "add to changelog", "record this in CHANGELOG", "release notes", "version history", "what changed". Also invoke proactively right before `git commit` when staged changes are user-visible, and after completing a feature or bug-fix task. Skip for: formatting-only diffs, test-only edits, doc typo fixes, generated-file churn, dependency lockfile bumps, internal scaffolding the user will never see.
---

# Update CHANGELOG.md

Append a new entry summarizing the current logical change to `CHANGELOG.md` at the repo root. One file, chronological, newest-on-top, emoji-prefixed bullets.

## When to invoke (and when not to)

Invoke when there is a *user-visible* or *engineering-significant* change that just landed or is about to be committed:

- New feature, capability, or UI surface
- Bug fix
- Performance improvement
- Security patch
- Larger technical refactor (architecture shift, module rename, dep swap users would notice)
- Breaking change or removal

**Do not invoke for** (return without writing):

- Pure formatting / whitespace / lint-only diffs
- Test-only edits (no production code change)
- Doc typo fixes
- Generated-file churn (lockfiles, build artifacts, snapshots)
- Trivial internal cleanup the user will never observe
- Work-in-progress scratch commits

If unsure, ask the user once: "Worth a changelog entry, or skip?"

## Step 1 — Determine what changed

Read the diff before writing. The wording must reflect the actual change, not the task description.

Source of truth, in order:
1. If staged changes exist (`git diff --cached --stat`) → use staged diff.
2. Else if unstaged changes exist (`git diff --stat`) → use working-tree diff.
3. Else → use the most recent commit (`git show --stat HEAD`).

Then read the actual diff (`git diff --cached` / `git diff` / `git show HEAD`) — not just file names — so the bullet describes behavior, not files touched.

Collapse the diff into **one logical change per bullet**. Multiple files implementing the same change = one bullet. Two unrelated changes in the same diff = two bullets.

When a diff produces multiple bullets, write the one with greater user impact first, and group all bullets contiguously at the top of the list (no blank lines between them).

## Step 2 — Pick the emoji

Use exactly one emoji from this canonical set as the first character of each bullet. Do not invent new ones.

| Emoji | Category | Use for |
|-------|----------|---------|
| ✨ | Feature | New user-facing capability |
| 🐛 | Bug fix | Corrects incorrect behavior |
| ⚡ | Performance | Faster, less memory, fewer queries |
| 🔒 | Security | Fixes a vulnerability or hardens auth/input handling |
| ♻️ | Refactor | Internal restructure users may notice (rename, reorg, dep swap) |
| 🎨 | UI / UX | Visual or interaction polish without new capability |
| 🔧 | Config | Build, tooling, env, or settings change devs will encounter |
| 📝 | Docs | User-facing documentation changes (README, public guides) |
| 🗑️ | Removal | Removed feature, endpoint, flag, or file |
| 💥 | Breaking | Backwards-incompatible change (also pair with the relevant category if helpful) |

If a change fits two categories (e.g. a perf fix that also fixes a bug), pick the one the *user* would care about more. If it's truly breaking, lead with 💥.

## Step 3 — Write the bullet

Before writing, ask: *would a user reading these notes a year from now care about this line?* If no, skip — it isn't changelog-worthy.

Format: `<emoji> <concise sentence>`

- Describe the change from the user's perspective, not the file's.
- Match the punctuation and casing of existing entries in the file.
- No issue/PR numbers unless the user asks for them.
- No file paths unless the change is dev-facing tooling (🔧).

**Good:**
- `✨ add CSV export to the reports page`
- `🐛 fix duplicate confirmation emails when signup is retried`
- `⚡ cut dashboard load time ~40% by batching project queries`
- `🔒 reject path traversal in file-download endpoint`

**Bad (rewrite before writing):**
- `✨ added new feature` — not specific
- `🐛 update handler.ts` — file-centric, not user-centric
- `♻️ misc cleanup` — not changelog-worthy; skip instead

## Step 4 — Place the entry

Read the existing `CHANGELOG.md`.

**If the file does not exist** — scaffold it:

```markdown
# Changelog

All notable changes to this project, newest first.

```

Then append the new bullet under the title block.

**If the file exists** — insert the new bullet at the top of the bullet list (immediately after the title/intro block, above all existing bullets). Preserve the existing file's exact spacing and trailing newline.

**Dedup check** — before writing, scan the top ~10 bullets. If a near-identical bullet (same emoji + same core verb/noun) already exists, do not add a duplicate. Either:
- Skip and tell the user it's already logged, or
- If the new change extends the prior one, replace the existing bullet with a refined version (and tell the user you did).

## Step 5 — Confirm

Print the bullet you added (or the dedup decision) in one line. Do not stage or commit the changelog yourself unless the user asked you to — leave that to the user's commit flow.

## NEVER

- **NEVER write a bullet without reading the actual diff first**
  **Instead:** Run the appropriate `git diff` / `git show` and base wording on observed changes.
  **Why:** Wording from memory or task description drifts from what actually shipped — produces misleading history.

- **NEVER add one bullet per file**
  **Instead:** Collapse all files implementing one logical change into a single bullet.
  **Why:** A changelog is a log of *changes*, not a log of *file edits*. Per-file bullets are noise.

- **NEVER invent new emojis or use multiple emojis per bullet**
  **Instead:** Pick exactly one from the canonical table; if it doesn't fit, the change probably isn't changelog-worthy.
  **Why:** Inconsistent emoji vocabulary makes the log unscannable and trains future entries to drift further.

- **NEVER log refactors, tests, formatting, or lockfile churn unless the user explicitly asks**
  **Instead:** Skip silently or ask once.
  **Why:** Internal churn pollutes a user-facing file and buries the entries that matter.

- **NEVER stage or commit `CHANGELOG.md` automatically**
  **Instead:** Write the file and stop. Let the user (or their commit flow) stage it.
  **Why:** Auto-staging surprises users mid-workflow and can land an entry the user wanted to revise.

- **NEVER add a duplicate or near-duplicate of an entry already at the top**
  **Instead:** Run the dedup check in Step 4; skip or refine the existing bullet.
  **Why:** Re-running the skill on the same change (common when iterating before commit) silently doubles entries.

- **NEVER log a bullet for changes not yet on disk**
  **Instead:** Re-read the diff at invocation time; if the change has been reverted, amended, or never written, refresh or drop the bullet.
  **Why:** Wording carried over from earlier in the conversation can describe code that no longer exists, baking phantom history into the log.
