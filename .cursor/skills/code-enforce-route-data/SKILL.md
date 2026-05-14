---
name: code-enforce-route-data
user-invocable: false
metadata:
  audience: handoff
description: Internal handoff target invoked by add-feature, modify-feature, and other mutation skills when working in TanStack Start projects. Enforces the route data pattern — every new route that reads server data must (1) define a colocated `queryOptions` builder exported alongside its `useX` hook in `src/queries/`, (2) prefetch in the route `loader` via `queryClient.ensureQueryData` (multiple queries → `Promise.all`), (3) read in JSX with `useQuery` against the same options. Also enforces that all in-app navigation — including link-styled buttons (`<Button asChild><Link>`) — uses `<Link>` from `@tanstack/react-router` so router intent-prefetch warms the loader cache. Activates when creating files in `src/routes/`, adding a `loader`, adding `useQuery`/`useSuspenseQuery`, editing `src/queries/`, or writing nav links. Trigger phrases for routing: "new route", "new page", "fetch data on this route", "loader", "ensureQueryData", "queryOptions", "prefetch", "use Link". Skip for routes with no server data, mutation-only flows (`useMutation`), programmatic post-action navigation (`router.navigate` after a mutation), and external links (`<a href="https://...">`).
---

# Code Enforce Route Data (TanStack Start)

This project's routes follow one shape. Deviating breaks SSR hydration, prefetch, or causes cache drift between loader and component.

## The shape

For every new route that reads server data:

1. **One source of truth — `src/queries/<feature>.ts`**: export a `queryOptions` builder *and* the matching `useX` hook from the same file. Same key, same fn, no duplication.
2. **Loader prefetches** via `queryClient.ensureQueryData`.
3. **Component reads** via `useQuery(sameQueryOptions)` — hits the warm cache instantly.
4. **All nav uses `<Link>`** so hovering/intent triggers the loader and warms the cache *before* the user clicks.

## Canonical files

### `src/queries/projects.ts`

```ts
import { queryOptions, useQuery } from "@tanstack/react-query";
import { getProject } from "~/fn/projects"; // server fn from src/fn/ — see code-enforce-layers skill

export const projectQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["project", id],
    queryFn: () => getProject({ data: { id } }),
  });

export const useProject = (id: string) => useQuery(projectQueryOptions(id));
```

### `src/routes/projects/$id.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { projectQueryOptions, useProject } from "~/queries/projects";

export const Route = createFileRoute("/projects/$id")({
  loader: ({ context: { queryClient }, params: { id } }) =>
    queryClient.ensureQueryData(projectQueryOptions(id)),
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const { data: project } = useProject(id);
  // data is guaranteed warm — loader awaited it
  return <h1>{project!.name}</h1>;
}
```

### Multiple queries on one route

```tsx
loader: ({ context: { queryClient }, params: { id } }) =>
  Promise.all([
    queryClient.ensureQueryData(projectQueryOptions(id)),
    queryClient.ensureQueryData(projectMembersQueryOptions(id)),
  ]),
```

### Search-param–driven queries

When the query depends on URL search params (filters, pagination), declare `loaderDeps` so the loader re-runs when params change, and pass them through `queryOptions`:

```ts
// src/queries/projects.ts
export const projectListQueryOptions = (args: { status: string; page: number }) =>
  queryOptions({
    queryKey: ["projects", args],
    queryFn: () => listProjects({ data: args }),
  });
```

```tsx
// src/routes/projects/index.tsx
export const Route = createFileRoute("/projects/")({
  validateSearch: (s): { status: string; page: number } => ({
    status: (s.status as string) ?? "active",
    page: Number(s.page) || 1,
  }),
  loaderDeps: ({ search: { status, page } }) => ({ status, page }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.ensureQueryData(projectListQueryOptions(deps)),
  component: ProjectList,
});

function ProjectList() {
  const deps = Route.useLoaderDeps();
  const { data } = useQuery(projectListQueryOptions(deps));
  // ...
}
```

Without `loaderDeps`, changing `?status=…` would not re-trigger the loader — the cache would stay on the original key and the UI would lag the URL.

### Nav — buttons that link

```tsx
// Plain link
<Link to="/projects/$id" params={{ id }}>Open</Link>

// Styled-as-button link (shadcn pattern)
<Button asChild>
  <Link to="/projects/$id" params={{ id }}>Open</Link>
</Button>
```

## NEVER

- **NEVER call `useQuery`/`useSuspenseQuery` on a route without a matching `loader` that calls `ensureQueryData` on the same `queryOptions`.**
  **Instead:** add the loader; reuse the colocated `queryOptions`.
  **Why:** without the loader, the component fetches on mount → SSR ships an empty shell, user sees a loading flash, hover-prefetch does nothing.

- **NEVER inline `{ queryKey, queryFn }` at the call site in a route or component.**
  **Instead:** import the colocated `queryOptions` builder from `src/queries/`.
  **Why:** key/fn drift between loader and component → loader warms key A, component subscribes to key B, cache miss every render.

- **NEVER use `queryClient.fetchQuery` in a loader.**
  **Instead:** use `queryClient.ensureQueryData`.
  **Why:** `fetchQuery` always refetches and ignores fresh cache; `ensureQueryData` returns cached data when fresh, so hover-prefetch + immediate click is a single network request, not two.

- **NEVER use `<a href="/internal-route">` or `router.navigate("/x")` inside an `onClick` for static in-app navigation.**
  **Instead:** `<Link to="...">` (or `<Button asChild><Link to="..."/></Button>` for styled-as-button).
  **Why:** only `<Link>` registers the route's loader for intent-based prefetch — without it, the user pays the full loader latency on click. `router.navigate` is reserved for post-mutation redirects where there's no clickable target.

- **NEVER use `useSuspenseQuery` for route data here.**
  **Instead:** use `useQuery(queryOptions(args))`. Loading UI lives in the route's `pendingComponent` (see `add-skeleton-loaders`).
  **Why:** this project standardizes on `useQuery` so loading state is rendered by the route's `pendingComponent`, not an in-component Suspense boundary — mixing the two creates two competing loading surfaces.

- **NEVER fetch route data in `useEffect`.**
  **Instead:** loader + `ensureQueryData` + `useQuery`.
  **Why:** `useEffect` runs only after hydration → no SSR data, double-render, no prefetch path. The whole pattern exists to delete this case.

- **NEVER read route data via `Route.useLoaderData()`.**
  **Instead:** read with `useQuery(queryOptions(args))`. The loader's job is solely to call `ensureQueryData` so the cache is warm; its return value is irrelevant to the read path.
  **Why:** `useLoaderData` bypasses the React Query cache entirely — subsequent invalidations, mutations, and background refetches won't update what the component sees, so the UI silently stales.

- **NEVER export a `queryOptions` builder from a different file than its `useX` hook.**
  **Instead:** colocate both in `src/queries/<feature>.ts`.
  **Why:** importers grab the hook and miss the options export; the loader ends up reconstructing keys by hand → drift.

## Decision tree

```
Does this route read server data?
├── No  → static route; skill does not apply.
└── Yes → Does an existing queryOptions live in src/queries/?
          ├── Yes → import it.
          └── No  → add `xQueryOptions` + `useX` colocated in src/queries/<feature>.ts.
                    queryFn calls a server fn from src/fn/ (see code-enforce-layers).

How many queries does the loader prefetch?
├── One   → return queryClient.ensureQueryData(qo).
└── Many  → return Promise.all([ensureQueryData(a), ensureQueryData(b), …]).

Does the query depend on URL search params?
├── No   → skip.
└── Yes  → add validateSearch + loaderDeps; pass deps into queryOptions(args).

Any nav rendered here or in callers?
├── No   → done.
└── Yes  → <a href="/internal">         → <Link to="...">
          <button onClick={navigate}>   → <Button asChild><Link to="...">
          External (https://…) or post-mutation router.navigate → leave as-is.
```

## Aligns with

- `code-enforce-layers` — `queryFn` calls a server function from `src/fn/`, never `src/data-access/` directly.
- `add-skeleton-loaders` — even with prefetch, the *first* visit (no hover) shows the route's `pendingComponent`; that skill governs its content.
