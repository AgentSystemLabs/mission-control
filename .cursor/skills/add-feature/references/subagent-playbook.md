# Subagent Fan-Out Playbook

Subagents speed work up *only* when the pieces are truly independent. The wrong fan-out is slower than serial because reconciling inconsistent outputs costs more than running them one after another.

---

## When to fan out

Fan out (parallel agents in a single message) when **all** are true:

1. The pieces touch different files with no shared edits.
2. No piece's API/contract shape determines another's.
3. Each piece can be briefed self-contained — file paths, contracts, constraints.
4. Outputs won't merge-conflict.

Common good fits:
- **Exploration:** "find how auth works" + "find how the job queue works" + "find existing pagination utilities" — three Explore agents in one message.
- **Reviews:** code review + security review + performance review on a finished diff.
- **Independent implementation:** a new DB migration AND an unrelated UI component AND a new doc snippet.

---

## When NOT to fan out

- One piece's response shape determines another's (server contract → client consumer).
- All edits land in the same file.
- The work is iterative — you'll learn from piece 1 before knowing how to do piece 2.
- The pieces are small enough that orchestration overhead exceeds the savings.

When in doubt, serial.

---

## Briefing template (Explore agents)

```
Codebase exploration — report under 300 words.

Goal: [what we're trying to learn, and why]
Already known: [what you've already established — prevents duplicated work]
Specifically find:
  - [concrete question 1]
  - [concrete question 2]
Report format:
  - File paths with line numbers
  - One-line summary per finding
  - Flag anything surprising
```

## Briefing template (Implementation agents)

```
Implement [specific scoped piece]. Do NOT touch anything outside the listed files.

Context: [feature one-liner]
Files you may create/edit: [explicit list]
Files you must NOT edit: [adjacent areas owned by other agents]
Contract: [exact signatures, types, or response shapes — frozen]
Constraints: [project conventions to follow]
Done when: [specific exit condition]
```

## Briefing template (Review agents)

```
Review the diff at [branch/commit/files]. Apply [specific checklist file].

Report:
  - Findings ranked by severity (blocker / should-fix / nit)
  - File:line references
  - Concrete fix suggestion per finding
Do NOT fix anything — report only.
```

---

## After fan-out

Consolidate. Read every agent's report. Resolve contradictions explicitly — don't average them. If two reviews disagree, decide which is right and why.
