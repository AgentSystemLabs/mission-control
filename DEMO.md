# Demo: bug → review → refactor → skill

A walkthrough of the prompts used to take a UI bug all the way to a reusable skill that prevents the same class of bug from recurring.

**Effort setting:** low (minimal). The whole flow ran on minimal reasoning effort — the point of the demo is that small, focused prompts compound, not that the model thinks for a long time on any one of them.

---

## Step 1 — Report the bug

> on the project page, after trying to create an agent, it shows 1 active in the tabs, but no cards show up. verify we are displaying.

What this prompt does well:
- **Concrete symptom** ("1 active in the tabs, but no cards show up") — no guessing what "broken" means.
- **One verification ask** ("verify we are displaying") — keeps scope to the rendering layer.

Outcome: the model traced it to the project page only rendering columns for `running`/`needs-input`/`done`, while new tasks default to status `"ready"`. Added the missing columns.

---

## Step 2 — Ask for a code review of the surrounding area

> review the code for how task status strings are defined and used, analyze if it's clean

Why this is the right next prompt:
- The bug fix added three columns, but didn't address **why the bug was possible in the first place**. This prompt zooms out from the symptom to the pattern.
- "Analyze if it's clean" gives the model permission to recommend changes without committing to them yet — separates *diagnosis* from *treatment*.

Outcome: the review surfaced four issues — a hand-maintained `VALID_STATUSES` array paralleling the union type (drift risk), six repeated `.filter` calls keyed on a status literal, scattered status literals across multiple files, and non-exhaustive status handling at several call sites.

---

## Step 3 — Approve the recommendations

> fix your recommendations

Why this works as one short prompt:
- The previous step produced a **ranked list of changes**. "Fix your recommendations" is the explicit go-ahead — no need to re-specify what to do.
- Trusts the model to keep ordering and stop where it had decided to stop (the review explicitly skipped a couple of items as not-worth-it).

Outcome: `TASK_STATUSES`/`TASK_AGENTS` became `as const` arrays with the type derived from them, the six filters collapsed to one `Record<TaskStatus, Task[]>`, columns and pills became `.map` over the const list, and `taskCounts` was reshaped to a status-keyed record. Typecheck stayed green throughout.

---

## Step 4 — Capture the lesson as a reusable skill

> create a skill that can be used after writing code to check for similar issues you just fixed related to duplicate code

Why this prompt is high-leverage:
- It converts a one-time fix into a **persistent capability** — every future edit can be checked against the same patterns.
- "After writing code" + "similar issues you just fixed" anchors the skill to the concrete patterns from Steps 2–3, not abstract "duplication" in general.
- "Related to duplicate code" narrows the skill's domain — it's not a general code reviewer, it's a parallel-enum-drift detector.

Outcome: a `check-duplication` skill scaffolded via skill-forge, scored A (90% / 108 pts) on skill-forge-judge, with five HITL improvements applied. The skill detects:

1. Hand-maintained runtime arrays paralleling a string-literal union (drift risk — the original bug class)
2. Repeated `.filter(x => x.field === "literal")` chains over the same field
3. Scattered enum literals across many files
4. Per-variant `if/else if` chains and sibling JSX blocks differing only by a literal prop

It reports findings ranked by severity and does **not** auto-fix — detection and refactoring are kept as separate decisions.

---

## The shape of the flow

```
bug report  →  verify + minimal fix
              ↓
          review nearby code  (zoom out from symptom to pattern)
              ↓
          approve fixes        (one-word green light)
              ↓
          extract a skill      (turn the lesson into a tool)
```

Each prompt is short. Each prompt does one thing. Each prompt builds on the previous step's output without re-stating it. The whole sequence took five user messages on minimal effort, and ended with both a fixed bug and a skill that prevents the same class of bug going forward.
