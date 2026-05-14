# Reproduction Modes

Pick the mode that matches the fix's git state. Use exactly the commands listed — these are tested combinations that produce a clean before/after toggle.

---

## A. Fix is in the working tree (unstaged)

The simplest case. The test goes in alongside, then we stash the fix files only.

```bash
# 1. Write the test file. Stage nothing yet.
# 2. Stash only the fix files (not the new test):
git stash push -- <fix-files>

# 3. Run the test — it must FAIL.
<test command>

# 4. Restore the fix:
git stash pop
```

Edge case: if the test imports symbols that the fix introduced (e.g., a new exported function), the test won't even compile in the stashed state. In that case, switch to mode E.

---

## B. Fix is staged but not committed

`git stash --keep-index` only stashes unstaged changes — not useful here. Either commit first (then use mode C) or unstage and use mode A.

```bash
git restore --staged <fix-files>
# now use mode A
```

---

## C. Fix is committed locally

Use a temporary git worktree so HEAD on the working branch stays intact.

```bash
# Create a worktree at the parent commit:
git worktree add /tmp/regression-check <fix-sha>~1

# Apply the new test to the worktree:
cp <test-file-relative-path> /tmp/regression-check/<test-file-relative-path>

# Run the test from the worktree:
cd /tmp/regression-check && <test command>
# It must FAIL.

# Cleanup:
cd - && git worktree remove /tmp/regression-check
```

---

## D. Fix is squashed into a larger commit

Revert just the relevant hunks in a worktree.

```bash
git worktree add /tmp/regression-check HEAD
cd /tmp/regression-check

# Restore the file's pre-fix state:
git checkout <pre-fix-sha> -- <fix-files>

# Drop the new test in:
cp <test-path> /tmp/regression-check/<test-path>

<test command>     # must FAIL

cd - && git worktree remove --force /tmp/regression-check
```

---

## E. Test depends on new symbols introduced by the fix

The pre-fix code can't import the new symbol, so the test won't run.

Choose one:

1. **Test against the public surface, not the new symbol.** If the fix added `validateSlug()` and a route uses it, test the *route's* behavior — that surface existed before and after.
2. **Stub the new symbol in the pre-fix run.** Temporarily inline the symbol with a no-op or pass-through implementation in the pre-fix worktree, so the test compiles and the underlying behavior fails.

Option 1 is preferred — it produces a more durable test that survives further refactors of the new symbol.

---

## When all modes fail

If you cannot construct a clean failing state, do not invent one. Stop and report:

```
Cannot verify pre-fix failure for <reason>.
Options:
  - Land the test as-is, marked with a comment explaining why pre-fix failure could not be demonstrated.
  - Skip the regression test for this fix and pin it via a different mechanism (manual QA log, monitoring alert).
```

Let the user choose. Do not silently ship an unverified regression test.
