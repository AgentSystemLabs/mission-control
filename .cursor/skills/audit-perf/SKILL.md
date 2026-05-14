---
name: audit-perf
description: Static performance audit of a route, page, server function, or module — finds N+1 query patterns, missing DB indexes for filtered/joined columns, oversized SELECT * fetches, blocking sequential awaits that could parallelize, unmemoized React hot-path computations, oversized client bundles from accidental server-only imports leaking to the client, and synchronous file/network reads inside request handlers. Reads files; does not run benchmarks. Reports findings ranked by likely impact with concrete fixes (add index on X, batch with dataloader, Promise.all these awaits, dynamic-import this dep, move this to the loader). Trigger phrases — "audit perf", "this page is slow", "why is this slow", "/audit-perf", "perf review", "find n+1", "check for performance issues", "audit query performance", "bundle size audit". Skip for — single-line tweaks, copy edits, infra-level perf (DB tuning, k8s sizing), and runtime profiling needs (recommend a real profiler).
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Audit Perf

Static analysis only. Every finding has an evidence line (file:line) and a concrete fix. No "consider optimizing" — either a measurable issue is visible in the code or it isn't reported.

---

## Phase 1 — Scope

Default scope = a route, page, or module the user names. If the user says "the slow page", confirm which route. If they say "the codebase", narrow to one entry point — perf audits across the whole repo produce noise, not signal.

Read the entry point and follow its imports two layers deep (the route file, any colocated loader/server-fn, and the data-access functions it calls). Do not chase the entire dependency graph — most perf bugs live in the data path and the render path.

**Exit:** the file set to scan is fixed (typically 3–10 files).

---

## Phase 2 — Run the Pattern Sweep

**MANDATORY — READ [`references/perf-patterns.md`](references/perf-patterns.md)** for the full pattern catalog.

For each file in scope, scan for the pattern catalog. Each match becomes a finding with:

- **File:line**
- **Pattern name** (one of the catalog entries)
- **Likely impact** (high / medium / low — see catalog for the rubric)
- **Suggested fix** (concrete, code-level)

Skip patterns that don't apply to the stack — e.g., don't flag missing React.memo in a non-React project.

**Exit:** all files scanned; raw findings list compiled.

---

## Phase 3 — Triage

Drop findings that are false positives:

- A `for await` over a small fixed list (≤ a handful of items) is not an N+1.
- `SELECT *` on a table with one or two narrow columns is fine.
- An unmemoized computation inside a component that renders once per page load is fine.

For each remaining finding, restate the impact in concrete terms: "this fires N additional DB queries per request, where N = number of items in `posts`" beats "potential N+1 issue."

**Exit:** triaged list with concrete impact statements.

---

## Phase 4 — Report

Group findings by impact tier. Within each tier, order by file path so the user can read top-to-bottom.

```
Performance Audit — <scope>
───────────────────────────

HIGH IMPACT
  src/fn/getPosts.ts:42
    Pattern: N+1 query in author lookup
    Impact:  one DB roundtrip per post (current page = 50 posts → 51 queries)
    Fix:     batch with `inArray(authors.id, posts.map(p => p.authorId))` and zip in JS,
             or expose a dataloader

  src/routes/dashboard.tsx:18
    Pattern: missing index on filter column
    Impact:  `where(eq(events.userId, ...))` over a table with no index on userId →
             full table scan as the table grows
    Fix:     add index in drizzle schema: index('events_user_id_idx').on(table.userId)

MEDIUM IMPACT
  ...

LOW IMPACT
  ...
```

End with a one-line summary: `<n> findings (high: x, med: y, low: z). No fixes applied.`

---

## NEVER

- **NEVER apply fixes from this skill.**
  **Instead:** report findings only. The user runs the appropriate skill (or their own judgment) to apply.
  **Why:** perf fixes are tradeoffs (an index speeds reads but slows writes; memoization adds complexity). The user owns the decision. An audit that auto-fixes erodes the audit/apply boundary and makes the diff harder to review.

- **NEVER report a finding without a file:line.**
  **Instead:** every finding cites the exact location. If you cannot point at a line, the finding is a guess.
  **Why:** unsourced findings train the user to skim or ignore the report. A line number lets them verify in seconds.

- **NEVER report "potential" issues.**
  **Instead:** if you can't explain the concrete impact (rows scanned, requests fired, KB shipped to client), drop the finding.
  **Why:** "potential" is the audit version of "be careful" — it costs the user attention and pays back nothing.

- **NEVER recommend speculative micro-optimizations.**
  **Instead:** focus on patterns where the impact scales with input size (N+1, missing index, full-table scan, unbounded fetch). Skip "use a tighter loop" or "prefer Set over Array".
  **Why:** micro-optimizations rarely matter and almost always cost readability. The audit's value is in finding the order-of-magnitude wins.

- **NEVER conflate static-analysis findings with runtime profiling.**
  **Instead:** if the user wants to know what's actually slow in production, recommend a real profiler (browser devtools, server-side APM, EXPLAIN ANALYZE) and stop.
  **Why:** static patterns predict but don't measure. A static finding can be a non-issue at runtime; a real bottleneck can have no static signature. Pretending static = runtime misleads the user.

- **NEVER scan the whole repo by default.**
  **Instead:** narrow to one route / page / module. Refuse a "scan the whole codebase" request and ask which entry point matters.
  **Why:** a full-repo perf scan produces hundreds of low-impact findings that drown the high-impact ones. The signal lives in the slow path.
