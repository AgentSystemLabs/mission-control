# Regression Hunt (fix-bug mode=regression)

Load this reference when fix-bug is invoked in `mode=regression` — i.e. the user reported a feature that used to work and is now broken with a named past-working anchor.

Localize the commit that broke a previously working feature, then explain the root cause. **You stop at "commit X broke it because Y." The user decides whether to revert, patch, or refactor.**

---

## Phase 1 — Confirm It's a Regression

Regression workflows only work when there's a known-good past anchor — without one, this is debugging, not history search. Bisect on a feature that never worked finds noise; log/blame on a never-worked feature points at whoever wrote it last, not at a cause. So before any git work, confirm two things from the user (ask if not stated):

1. **Did this feature actually work before?** A specific past time anchor — "worked on Friday", "worked in v1.4", "worked before the auth refactor". Vague ("I think it used to work") is not enough.
2. **What's the exact broken behavior now?** Concrete symptoms: error message, wrong output, crash, missing UI element.

**If the user can't confirm it worked before → stop and exit `mode=regression`. Continue in fix-bug's default debugging workflow.**

State back: "Regression in [feature]: worked at [anchor], now [symptom]. Hunting for the commit that changed it."

---

## Phase 2 — Working Tree Must Be Clean

Run `git status`. If there are uncommitted changes or untracked files relevant to the affected area:

**Refuse to proceed.** Tell the user exactly what's dirty and ask them to either:
- `git stash -u` (and remember to pop after)
- commit the changes
- discard them if intentional

**Why this is non-negotiable:** Phase 4 (bisect) checks out arbitrary historical commits. Uncommitted work will be carried across checkouts, contaminating every test, or lost outright. Do not bypass this check.

---

## Phase 3 — Establish a Deterministic Reproduction

Before touching history, define **one command or one short procedure** that reliably distinguishes "broken" from "working" — every time, in under ~30 seconds ideally.

Forms it can take:
- A failing test: `npm test -- path/to/file --grep "name"`
- A CLI invocation with expected vs. actual output
- A 3-step manual UI procedure with a clear pass/fail at the end
- A curl request and the expected status/body

Write the repro down explicitly in your response so it's reusable across every checkout in Phase 4. **If you cannot produce a deterministic repro, stop and tell the user — bisecting without one produces meaningless results.**

Verify the repro on `HEAD` (it should fail) before continuing.

---

## Phase 4 — Search History (Cheap Path First)

Try these in order. Stop as soon as you have a strong suspect commit.

1. **`git log` on affected paths**, scoped by the user's "worked at" anchor (`--since`). Scan messages for the feature name, related refactors, dependency bumps, config changes.
2. **`git log -S"<symbol>"`** to find the commit that added or removed a specific function name, string, or token tied to the broken behavior. Higher signal than message scanning when you know what to grep for.
3. **`git blame`** on the suspect lines, then `git show` on each suspicious sha.

For each plausible suspect: read the full diff, explain to the user how it could cause the symptom, and verify by checking out the commit *before* it and running the repro. Confirmed → go to Phase 6.

**Budget: ~10 plausible commits inspected with no clear suspect → escalate to bisect.** Don't keep grinding log/blame past that — you're past the point where the cheap path is cheaper than binary search.

---

## Phase 5 — Manual Git Bisect (Escalation)

**MANDATORY — READ [`git-bisect.md`](git-bisect.md)** before starting bisect. It covers the good/bad/skip protocol, merge commits, recovery from a bad bisect, and how to abort cleanly. Do NOT load this file during Phases 1–4.

Walk the user through bisect interactively, one checkout at a time. You run the repro (or instruct them to), report pass/fail, mark the commit good/bad/skip, and continue until git names the first bad commit.

---

## Phase 6 — Root Cause and Handoff

Once the offending commit is identified:

1. Show `git show <sha>` and point to the specific hunk that causes the symptom.
2. Explain **why** that change breaks the feature — connect the diff to the reproduction's failure mode. "This commit removed X, which the feature relied on for Y" is the goal. "This commit looks suspicious" is not enough.
3. List the user's options without picking one:
   - Revert the commit (`git revert <sha>`) — when the change is wholly wrong or no longer needed
   - Patch forward — when the commit's intent is correct but execution broke this feature
   - Refactor — when the breakage reveals a deeper design issue
4. **Stop.** Do not apply a fix. Wait for the user's decision.

If a bisect was run, remind the user to `git bisect reset` if you haven't already, and to `git stash pop` if they stashed in Phase 2.

---

## NEVER (regression-mode-specific)

- **NEVER start bisect without a deterministic reproduction**
  **Instead:** Complete Phase 3 first. If no repro is possible, exit and tell the user.
  **Why:** Bisect is binary search over a pass/fail signal. Without a reliable signal, bisect marks commits good/bad essentially at random and lands on an innocent commit, wasting time and eroding trust.

- **NEVER mark a commit good or bad without actually running the repro on it**
  **Instead:** If you can't or didn't run the repro at this checkout, use `git bisect skip`.
  **Why:** Bisect is binary search; one wrong mark sends it down the wrong half and lands on an innocent commit. "Looks unrelated" or "the message says docs" is not evidence — only the repro is.

- **NEVER bisect on a dirty working tree**
  **Instead:** Refuse in Phase 2 until the user stashes or commits.
  **Why:** Bisect checks out historical commits; uncommitted changes get carried along and either contaminate the repro at every step or are silently lost on checkout.

- **NEVER auto-revert or auto-patch the bad commit**
  **Instead:** Stop at root-cause explanation in Phase 6 and present options.
  **Why:** The commit may be load-bearing for other features the user knows about and you don't. Reverting can fix the symptom and break three other things; only the user has the full picture.

- **NEVER treat a never-worked bug as a regression**
  **Instead:** In Phase 1, require a concrete past-working anchor. Exit regression mode if absent.
  **Why:** Bisect on a feature that never worked finds noise — every commit is "bad" or "good" arbitrarily. The user needs ordinary debugging, not history search.

- **NEVER trust commit messages as proof a commit is innocent**
  **Instead:** Read the diff (`git show <sha>`). A commit titled "rename variable" can change behavior if the rename collided with a shadowed name elsewhere.
  **Why:** Commit messages describe intent; diffs describe reality. Regressions often hide in commits whose messages sound unrelated to the broken area.

- **NEVER skip `git bisect reset` at the end**
  **Instead:** Always reset before handoff in Phase 6, and verify with `git status` that HEAD is back where it started.
  **Why:** Leaving the repo in bisect state means the user's next `git pull` or branch switch behaves strangely and they won't know why.

- **NEVER bisect across unrelated history boundaries (e.g. major version bumps, framework migrations) without warning the user**
  **Instead:** If the bisect range spans a known-disruptive event, surface it: "Bisecting across the v2 migration — many commits in this range may not build. Skips will be common."
  **Why:** Half the commits won't build or run; bisect becomes mostly `skip` and either gives up or returns a misleading result. The user may want to bound the search differently.
