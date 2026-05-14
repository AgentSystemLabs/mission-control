---
name: resolve-conflict
description: Walk a developer through a git merge or rebase conflict carefully — read each conflicted file's `<<<<<<<` markers, understand both sides' intent before choosing, present per-file resolutions, and never silently discard one side's work. Handles lockfile conflicts (regenerate, don't hand-merge), generated-file conflicts (rebuild, don't merge), and semantic conflicts where both sides edit different lines but the combined result is broken. Trigger phrases — "resolve conflicts", "I have merge conflicts", "fix this rebase", "/resolve-conflict", "stuck in a rebase", "merge conflict help". Skip for — clean merges, conflicts the user has already resolved, force-push or "just take theirs/ours" requests where the user has explicitly accepted the loss of one side.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Resolve Conflict

A merge conflict means git could not pick — both branches changed the same lines. The dangerous failure mode is "pick theirs" or "pick ours" without reading both, which silently throws away work. This skill exists to make that failure mode hard.

---

## Phase 1 — Identify the State

Determine what operation is mid-flight:

- `.git/MERGE_HEAD` exists → in a merge.
- `.git/REBASE_HEAD` or `.git/rebase-merge/` or `.git/rebase-apply/` → in a rebase.
- `.git/CHERRY_PICK_HEAD` → in a cherry-pick.
- None of the above + `git status` shows conflicts → likely a stash pop or apply.

Run `git status` to list `Unmerged paths`. Group them:

| Group | Paths | Strategy |
|---|---|---|
| Lockfiles | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `Gemfile.lock`, `go.sum` | Regenerate, do not hand-merge. |
| Generated | `*.gen.ts`, files in `drizzle/`, `__generated__/`, `dist/` | Rebuild from source after resolving the source files. |
| Source | everything else | Hand-resolve per Phase 3. |

**Exit:** the operation is identified and the file groups are listed.

---

## Phase 2 — Resolve Lockfiles First

For each lockfile in the lockfile group:

```bash
# 1. Take the version that matches the package manifest's resolved tree:
git checkout --theirs <lockfile>      # or --ours, depending on which side's package.json wins
# 2. Regenerate to make sure it actually matches:
<install command without writing manifest changes>   # e.g. pnpm install --no-frozen-lockfile
# 3. Stage:
git add <lockfile>
```

If the conflict is in `package.json` (or pyproject.toml etc.) too, resolve that first as a source file, then regenerate the lockfile from the merged manifest.

**Exit:** all lockfiles staged with a regenerated, internally-consistent state.

---

## Phase 3 — Resolve Source Files

For each source file in the source group:

1. **Read the whole file** — not just the conflict markers. Context above and below tells you what the function/component is supposed to do.

2. **Identify each conflict block** (`<<<<<<<` … `=======` … `>>>>>>>`). For each block, write down in your head:
   - What was on the **HEAD/ours** side trying to do?
   - What was on the **incoming/theirs** side trying to do?
   - Are they: **identical intent** (just whitespace/format), **complementary** (both should land), or **incompatible** (one must win)?

3. **Resolve per block:**

   | Case | Resolution |
   |---|---|
   | Identical intent | Keep one side; check formatting matches project style. |
   | Complementary (e.g., both added a different prop, both added a different import) | Combine both changes. |
   | Incompatible (both edit the same logic differently) | **Stop.** Surface to the user with both versions side-by-side. Do not guess. |
   | One side is clearly a refactor that subsumes the other | Keep the refactor side and re-apply the other side's intent on top. |

4. **Remove all markers** (`<<<<<<<`, `=======`, `>>>>>>>`). If any remain, the file is not resolved.

5. **Run typecheck/lint on the file** if the project supports it. Resolution that compiles is necessary but not sufficient.

6. `git add <file>`.

**Exit:** every source file is staged, and every "incompatible" case has been surfaced to the user with their explicit choice recorded.

---

## Phase 4 — Rebuild Generated Files

After source files are resolved, regenerate any generated files that conflicted:

- Drizzle migrations: re-run the codegen command.
- GraphQL/OpenAPI codegen: re-run the codegen.
- Build artifacts: rebuild.

Do not hand-merge generated files. The output of regeneration is the source of truth.

`git add` the regenerated files.

**Exit:** generated files match what regeneration produces from the merged source.

---

## Phase 5 — Continue the Operation

- Merge: `git commit` (the message is pre-populated).
- Rebase: `git rebase --continue`.
- Cherry-pick: `git cherry-pick --continue`.

If the next commit in a rebase produces another set of conflicts, loop back to Phase 1 with the new state. Each commit's conflicts are resolved independently — do not try to "resolve all rebase conflicts at once".

If the user wants to abort: `git merge --abort` / `git rebase --abort` / `git cherry-pick --abort`. Recommend this if the conflict count is high (>10 files) and the user wasn't expecting the operation — abort, regroup, then retry with a different strategy.

---

## Phase 6 — Report

```
Resolved <N> conflicted files.
  Lockfiles:   <count> regenerated
  Generated:   <count> rebuilt
  Source:      <count> hand-merged
    Combined both sides:    <list>
    Took ours:               <list> (with reason)
    Took theirs:             <list> (with reason)
    Refactor + re-apply:     <list>

Verify before pushing: <test command>
```

Remind the user to run the test suite — a successful merge can still be semantically broken.

---

## NEVER

- **NEVER use `git checkout --theirs` or `--ours` on a source file without reading both versions first.**
  **Instead:** read the file, identify each block's intent, choose per block. Use `--theirs`/`--ours` only on lockfiles and generated files.
  **Why:** `--theirs` on a whole source file silently discards every change ours made to that file — hours of work, gone with no diff to review. The fastest-feeling resolution is the most destructive.

- **NEVER hand-merge a lockfile.**
  **Instead:** take one side, regenerate from the manifest. If the manifests conflict, resolve manifests first.
  **Why:** lockfiles encode a graph of resolved versions and integrity hashes. A hand-merged lockfile produces a tree that no install ever computed — installs will diverge between machines and CI.

- **NEVER guess on incompatible blocks.**
  **Instead:** stop, present both versions, ask the user which intent should win.
  **Why:** the conflict marker exists exactly because git couldn't decide. If you "decide" without checking, you're committing a bug — possibly the bug each side was trying to fix differently. Only the human knows which is right.

- **NEVER consider a file resolved while a conflict marker remains.**
  **Instead:** grep for `<<<<<<<`, `=======`, `>>>>>>>` after each file. Any hit means the file is not done.
  **Why:** stray markers compile in some languages (no, they don't), break builds, and ship to production if missed. The check costs nothing.

- **NEVER continue the rebase/merge while there are unresolved files in `git status`.**
  **Instead:** finish every Unmerged path first; verify with `git status` that the list is clean.
  **Why:** `git rebase --continue` with unmerged paths errors out — but `git commit` on a merge with some files staged and some still conflicted will silently commit a half-resolved tree if the conflict markers happen to be in unstaged hunks. Defense in depth: always verify status is clean.

- **NEVER bundle "while I'm here" cleanup into a conflict resolution.**
  **Instead:** restrict edits to the conflict blocks. Refactors go in a follow-up commit.
  **Why:** a conflict resolution diff that includes unrelated changes is impossible to review. Reviewers cannot tell which lines came from which side; bisect later cannot tell the resolution from the refactor.

- **NEVER treat a successful build as proof of a correct resolution.**
  **Instead:** run the test suite; a passing build only means the code compiles.
  **Why:** the most common merge bug is two complementary changes that compile together but produce wrong behavior — both branches edited a state machine in compatible-looking ways that combined into a logical error. Tests are the only thing that catches this.
