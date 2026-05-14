# Performance Pattern Catalog

For each pattern: a static signature, an impact rubric, and a fix.

---

## P1. N+1 query (HIGH)

**Signature:** a loop or `for-of` body where each iteration awaits a DB call. Common shapes:

```ts
for (const post of posts) {
  const author = await db.select(...).from(authors).where(eq(authors.id, post.authorId))
}

// Or .map(async ...) without batching:
await Promise.all(posts.map(p => db.select(...).from(authors).where(eq(authors.id, p.authorId))))
```

The second form parallelizes the queries but still issues one per item — still N+1.

**Impact:** scales linearly with input size. HIGH whenever the loop iterates over a request-time collection.

**Fix:** batch with `inArray(...)` and zip in JS, or introduce a dataloader.

---

## P2. Missing index on filtered/joined column (HIGH if growing table, MED if small)

**Signature:** a Drizzle (or other ORM) `where(eq(table.col, ...))`, `where(inArray(...))`, or a join on `table.col` where the schema for `table` does not declare an index on `col`.

**Impact:** full-table scan whose cost grows with row count. HIGH for tables expected to grow (events, audit logs, posts); MEDIUM for small lookup tables (< 1k rows expected).

**Fix:** add `index('<table>_<col>_idx').on(table.col)` to the Drizzle schema and a migration.

---

## P3. SELECT * on a wide table when the consumer reads few columns (MEDIUM)

**Signature:** `db.select().from(...)` (no projection) where the caller reads only `result.id` / `result.name`.

**Impact:** wasted bandwidth, slower queries when the table has wide columns (text, jsonb, blobs).

**Fix:** project: `db.select({ id: posts.id, name: posts.name }).from(posts)`.

---

## P4. Sequential awaits with no data dependency (MEDIUM)

**Signature:**

```ts
const a = await getA()
const b = await getB()   // does not depend on a
return { a, b }
```

**Impact:** roundtrip-bound — total latency = sum, could be max.

**Fix:** `const [a, b] = await Promise.all([getA(), getB()])`.

---

## P5. Unbounded fetch (HIGH if user-facing)

**Signature:** `db.select().from(table)` with no `.limit(...)` and no upstream filter.

**Impact:** memory + latency scale with table size. HIGH if reachable from a user-facing endpoint.

**Fix:** add a `.limit(...)` and pagination, or push the filter from the caller.

---

## P6. Server-only import leaking into client bundle (HIGH for bundle, MED for security)

**Signature:** in a `.tsx` file that ships to the client (component, hook, route component body), an import from `node:*`, `fs`, `crypto`, `pg`, `drizzle-orm/node-postgres`, server-only env reads, etc. In TanStack Start, this is anything imported at the top of a route file that isn't behind a server-fn boundary.

**Impact:** balloons the client bundle by 100s of KB; can also leak credentials if env reads are bundled.

**Fix:** move the import behind a server function (`createServerFn`) or `'use server'` boundary; the client should only import the function reference.

---

## P7. Synchronous I/O in a request handler (HIGH)

**Signature:** `fs.readFileSync`, `fs.writeFileSync`, or `child_process.execSync` inside a request handler / server function / route loader.

**Impact:** blocks the event loop for the duration of the I/O — every concurrent request waits.

**Fix:** use the async variants (`fs.promises.readFile`).

---

## P8. Unmemoized expensive computation in a hot render path (MEDIUM, sometimes LOW)

**Signature:** a React component that does sorting, filtering of large arrays, or heavy parsing in its function body without `useMemo`, and the component re-renders frequently (lives inside a list, depends on context that updates often).

**Impact:** runs on every render. MEDIUM when the data is large (>1k items) and re-render frequency is high. LOW otherwise — `useMemo` adds complexity and isn't free.

**Fix:** wrap in `useMemo` with the right dependency array. Skip if the input is small or the component renders once.

---

## P9. Loader fetches that should be a single request (MEDIUM)

**Signature:** TanStack Start route loader (or Next loader, or React Query setup) that fires N independent `ensureQueryData` calls in series, where the calls don't depend on each other.

**Impact:** waterfall — total loader time = sum.

**Fix:** `await Promise.all([ensureQueryData(a), ensureQueryData(b)])`.

---

## P10. Unbounded list rendering without virtualization (MEDIUM)

**Signature:** a `.map(...)` over a list of unknown size (DB result, paginated data with no cap) that renders DOM nodes.

**Impact:** if the list grows past a few hundred items, layout/paint stalls.

**Fix:** introduce a virtual list (`@tanstack/react-virtual`) or enforce server-side pagination.

---

## Impact rubric (when in doubt)

- **HIGH:** scales with request input size; user-facing latency; reachable from a hot path.
- **MEDIUM:** scales with database/dataset size over time; not yet user-visible but will be.
- **LOW:** constant-factor; only matters under specific conditions; the fix has its own cost.
