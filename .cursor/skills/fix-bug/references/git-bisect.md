# Git Bisect — Manual Walkthrough

Use this when Phase 4 (cheap log/blame inspection) hasn't found the regressing commit. You drive bisect interactively with the user, one step at a time.

---

## Setup

You need two commit boundaries:

- **bad** — usually `HEAD`, where the repro fails
- **good** — a commit where the repro passes

**Picking `good` carefully matters.** If the user says "worked Friday", find a commit from before Friday. Don't guess — check out a candidate and run the repro to confirm it actually passes. A wrong `good` poisons the entire bisect.

```
git bisect start
git bisect bad                    # current HEAD is broken
git bisect good <sha-or-tag>      # confirmed-working commit
```

Git checks out a commit halfway between, and you test.

---

## The Loop

For each commit git checks out:

1. Run the deterministic repro from Phase 3.
2. Mark the result:
   - Repro fails (bug present) → `git bisect bad`
   - Repro passes (bug absent) → `git bisect good`
   - Commit won't build, tests crash for unrelated reasons, or you genuinely can't tell → `git bisect skip`
3. Git checks out the next commit. Loop.

Continue until git prints `<sha> is the first bad commit` followed by the commit details.

---

## Decision Tree: Which Mark to Use

```
Did the repro run cleanly?
│
├── YES → Did the bug appear?
│          ├── YES → git bisect bad
│          └── NO  → git bisect good
│
└── NO  → Why did it fail to run?
           ├── Build/compile error          → git bisect skip
           ├── Unrelated test failure       → git bisect skip
           ├── Missing dep / lockfile drift → try install; if still broken, skip
           ├── Repro itself doesn't apply
           │   (e.g. file didn't exist yet) → git bisect skip
           └── Genuine ambiguity            → git bisect skip
```

**Skip liberally — but not for "I think it's good."** Skip means "I can't determine." Guessing good/bad on a commit you didn't actually test corrupts the result.

---

## Handling Merge Commits

When bisect lands on a merge commit and marks it bad, the regression came from the merged branch. `git show <merge-sha>` shows the combined diff but can be huge. Use:

```
git log <merge-sha>^1..<merge-sha>^2 --oneline
```

to list the commits that came in via the merge. If the bisect result is a merge, the *real* offender is usually one of those commits — inspect them directly.

---

## When Many Commits Skip

If you're skipping more than ~30% of the commits, bisect will eventually print `There are only 'skip'ped commits left to test` and give a list of candidates. At that point:

1. Read each candidate commit's diff.
2. Apply judgment — which is most plausibly related to the broken feature?
3. Tell the user this happened; bisect couldn't isolate further automatically.

This commonly happens across framework migrations, dependency major bumps, or branch merges that broke the build temporarily.

---

## Recovery and Cleanup

**Always reset when done, including on abort:**

```
git bisect reset
```

This returns HEAD to wherever it was when you started. Verify with `git status` and `git log -1`.

**If you marked a commit wrong** (said `good` when it was `bad` or vice versa) and bisect lands on an obviously innocent commit:

```
git bisect log              # shows the marks you've made
git bisect reset            # abort
# then start over with corrected boundaries
```

You can also `git bisect replay <file>` after editing the log, but starting fresh is usually faster than salvaging.

---

## Automated Bisect — Not Used Here

`git bisect run <script>` exists and is powerful, but **this skill walks the user through manually** so they see each commit and can apply judgment on edge cases (skips, ambiguous results, merge commits). Don't switch to `bisect run` mid-flow.
