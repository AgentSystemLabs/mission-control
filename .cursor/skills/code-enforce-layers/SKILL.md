---
name: code-enforce-layers
user-invocable: false
metadata:
  audience: handoff
description: Internal handoff target invoked by add-feature, modify-feature, and other mutation skills when working in TanStack Start projects to enforce the layered architecture — routes/components/hooks/queries call server functions in `src/fn/`, which call use cases or data access; only `src/data-access/` touches Drizzle/the database. Activates whenever a feature crosses the client→server→DB boundary or when files are created in `src/routes/`, `src/components/`, `src/hooks/`, `src/queries/`, `src/fn/`, `src/use-cases/`, or `src/data-access/`. Trigger phrases for routing: "where does this go", "create endpoint", "new server function", "fetch data", "save to database".
---

# Code Enforce Layers (TanStack Start)

The dependency chain is fixed. Each layer imports only from layers below it.

```
routes  →  components  →  hooks  →  queries  →  fn  →  (use-cases)  →  data-access  →  db
```

Third-party infra I/O (Stripe API calls, S3/R2 presigning, email send) is **data-access-shaped** — wrap each provider in a module under `src/data-access/` (e.g. `data-access/stripe.ts`) and call it from `fn` or a use case. Do not call SDKs directly from `fn/` or `use-cases/`.

`use-cases` is **optional** — only insert it when business rules span multiple `data-access` calls or enforce policy (plan limits, ownership across entities, multi-step invariants). Plain CRUD goes `fn → data-access` directly.

## Where each concern lives

> Quick lookup — full layer purposes are in `docs/architecture.md`. Do NOT re-read that doc unless this table is ambiguous for your case.


| Concern | Layer |
|---|---|
| URL params, route loaders calling `queryClient.ensureQueryData` | `src/routes/` |
| JSX, local UI state, event handlers | `src/components/` |
| `useMutation`/`useQuery` wrappers, toasts, `navigate(...)`, cache invalidation | `src/hooks/` |
| `queryOptions({ queryKey, queryFn })` definitions | `src/queries/` |
| `createServerFn`, Zod `inputValidator`, `authenticatedMiddleware`, ownership checks, calling a use case OR data-access | `src/fn/` |
| Multi-step business rules, plan-limit enforcement, cross-entity orchestration, custom error classes | `src/use-cases/` |
| Drizzle queries (`database.select/insert/update/delete`), presigned URL generation | `src/data-access/` |

## Before writing any new code, ask

1. **Does this touch the database?** If yes, the actual `database.*` call lives in `src/data-access/` — nowhere else.
2. **Is there a business rule beyond "validate input + persist"?** (limits, multi-entity coordination, policy) → wrap in a `*UseCase` in `src/use-cases/`. Otherwise the `fn` calls data-access directly.
3. **Does the component need server state?** It calls a hook. The hook calls a query. The query calls the `fn`. Do not shortcut.
4. **Is this a route loader?** Use `queryClient.ensureQueryData(someQuery(...))` — never call `fn`s or data-access directly from a loader.
5. **Tempted to skip a layer "just this once"?** Name the failure mode in the NEVER list that you believe doesn't apply here, and say why this case is genuinely different. If you can't, you're rationalizing — follow the chain.

## NEVER

- **NEVER import from `src/fn/` inside a component or route file**
  **Instead:** Add a hook in `src/hooks/` that wraps a query from `src/queries/`, and import the hook.
  **Why:** Direct fn imports bypass TanStack Query caching, dedup, and invalidation — every render becomes an uncached round-trip and mutations leave stale cache.

- **NEVER write `database.select/insert/update/delete` (or any Drizzle query builder call) outside `src/data-access/`**
  **Instead:** Add or extend a function in `src/data-access/` and call it from `fn` or a use case.
  **Why:** Drizzle leaking into `fn/` or `use-cases/` makes those layers untestable without a real DB and duplicates query logic across endpoints.

- **NEVER put plan-limit checks, ownership-across-entities checks, or multi-step business rules inside `src/data-access/`**
  **Instead:** Put them in a `src/use-cases/*UseCase.ts` that orchestrates multiple data-access calls and throws domain errors (e.g. `PlaylistLimitError`).
  **Why:** Data-access must stay a thin DB shim; mixing in policy means rules get duplicated and skipped depending on which fn calls which data-access function.

- **NEVER import upward (use-case importing fn, data-access importing use-case, hook importing component, etc.)**
  **Instead:** Move the shared piece down to a layer both callers can reach, or pass it in as an argument.
  **Why:** Upward imports create cycles, break SSR (server-only code pulled into client bundles), and collapse the layering into a ball of mud.

- **NEVER define `queryOptions` or `queryKey`s inline inside a hook or component**
  **Instead:** Define them in `src/queries/<entity>.ts` and import. Hooks reference the same query object so cache keys match across read sites and invalidations.
  **Why:** Inline keys drift — one place writes `["song", id]` and another `["songs", id]`, so `invalidateQueries` silently misses and the UI shows stale data.

- **NEVER do auth/ownership checks inside `data-access/` or `use-cases/`**
  **Instead:** `authenticatedMiddleware` + ownership comparison (`if (row.userId !== context.userId) throw ...`) belongs in the `fn` handler. The use case takes a trusted `userId`.
  **Why:** Use cases are reused across fns; if each one re-derives auth, you get inconsistent rules. Keeping auth at the fn boundary makes the trust boundary obvious.

- **NEVER generate presigned URLs or construct S3/R2 object keys inside `fn/` or `use-cases/`**
  **Instead:** Put the S3 client call and key construction in `src/data-access/` (alongside the entity it belongs to, e.g. `data-access/songs.ts`) and have the fn or use case call it.
  **Why:** Presigned URLs are infra I/O like a DB call — keeping them in data-access keeps the bucket/key conventions in one place, makes fn handlers trivially testable, and avoids two endpoints generating subtly different keys for the same resource.

- **NEVER call a server function from another server function to "reuse logic"**
  **Instead:** Extract the shared logic into a use case or a data-access function and have both fns call it.
  **Why:** fn-to-fn calls double-run validation/middleware and serialize through HTTP semantics needlessly; the shared logic belongs one layer down.

## Self-check before opening a PR

Walk these questions in order. If any answer is "no" or "I'm not sure", you have more work before this is shippable:

1. Is every Drizzle query and every third-party SDK call confined to a module in `src/data-access/<entity>.ts`?
2. If there are business rules beyond validate-and-persist, do they live in a `src/use-cases/<verb><Entity>UseCase.ts` — and does the use case receive a trusted `userId` rather than re-deriving auth?
3. Does the `src/fn/<entity>.ts` handler own the Zod `inputValidator`, the `authenticatedMiddleware`, the ownership check, and nothing more than orchestrating data-access / a use case?
4. For reads: is the `queryOptions` defined in `src/queries/<entity>.ts` (one source of truth for the query key) and consumed by both the hook and any route loader via `ensureQueryData`?
5. Does a `use<Verb><Entity>` hook in `src/hooks/` own toasts, `navigate(...)`, and `invalidateQueries` — so the component never touches `fn/` or `queries/` directly?
6. If you skipped any of the above, can you point at the specific NEVER above whose failure mode does not apply to this case — and say why?

## Post-step: client-bundle audit

If this pass moved imports across client/server boundaries or touched route/component/hook/query files, dispatch the **`reviewer-client-bundle`** subagent (`Agent(subagent_type=reviewer-client-bundle)`) before declaring the layer fix complete. The layer split is not shippable if it pulls Drizzle, server env, `fs`, `child_process`, Stripe/Postmark SDKs, or other server-only modules into the browser bundle.
