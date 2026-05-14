# Performance Review Checklist (DB / hot-path-gated)

Run only when the diff changed schema, queries, or known hot paths. Report findings as **blocker / should-fix / nit** with file:line.

## Schema
- New columns frequently filtered/joined → indexed?
- Compound index column order matches actual query predicates (most-selective leftmost)
- Foreign keys present where joins happen
- New `NOT NULL` column added to a populated table → has a default or backfill plan; doesn't lock prod
- Wide `TEXT` / `JSON` columns on hot rows → consider separate table if rarely needed
- Migrations safe under load: no `ALTER TABLE` that rewrites a large table without an online strategy

## Queries
- No `SELECT *` on wide tables in hot paths
- No N+1: list endpoints batch-load relations (single join / `IN (…)` / dataloader)
- `WHERE` predicates align with an index — explain-plan mentally; if uncertain, run `EXPLAIN`
- No `LIKE '%term%'` on large tables without full-text index
- No `ORDER BY` on unindexed columns over large result sets

## Pagination
- New list endpoints use cursor pagination for unbounded data, not `OFFSET` (offset is O(n))
- Cursor is on an indexed, monotonic column
- Page size capped server-side; no client-controlled unlimited fetches

## Transactions & Locking
- Long-running work not wrapped in a transaction holding row locks
- Write-then-read patterns don't depend on read-your-write across replicas (if project uses replicas)
- No SELECT … FOR UPDATE on hot rows without a tight scope

## Caching
- Repeated identical reads in a single request → memoized or batched
- New cache writes have a TTL or invalidation strategy; no unbounded growth
- Cache keys include all variables that affect the result (user/tenant/locale)

## Hot Paths
- New code in render loops, request middleware, or job tick — measure or reason about cost
- No JSON.parse / regex compile / heavy work inside tight loops; hoist outside
- Async fan-out is bounded (no `Promise.all` over user-controlled-length arrays without a limit)

## Payload Size
- New API responses don't return more data than the UI needs
- Large blobs streamed, not buffered fully in memory
- No accidental serialization of huge associations (e.g., user with all their messages)
