---
name: add-skeleton-loaders
description: Verify that any new TanStack Start route — or any new data-fetching section added to an existing route — renders shadcn `<Skeleton />` placeholders matching the eventual layout while data is in flight. Auto-fix gaps inline before reporting done. Trigger phrases and scenarios — creating a file in `src/routes/`, adding `useSuspenseQuery`/`useQuery`/route `loader` to a page, "new route", "new page", "add a page", "loading state", "skeleton", "Suspense fallback", "pendingComponent", any route showing a spinner / "Loading..." / blank space while fetching. Skip for: routes with no async data (pure static pages), pure backend changes, copy-only edits, mutation-only buttons (use a different loading pattern), modals/dialogs that fetch (skeleton inside the modal body still applies, but route-level rules don't).
---

# Skeleton Loaders for Routes

You just added or modified a route under `src/routes/`. Before reporting done, audit every async data source on the page and confirm a skeleton stands in for it during fetch. Fix gaps inline.

## Before drafting JSX, ask

- **Which regions of this page fetch independently?** Each one needs its own boundary so a slow query can't gate a fast one.
- **What does each region look like loaded?** That shape — rows, avatars, headings — is what the skeleton must mirror.
- **What's the smallest enclosing component that owns the data slot?** That's where the `<Suspense>` or `isPending` branch belongs, not the route layout.

## The contract

While data for any visible region is loading, that region must render `<Skeleton />` placeholders (from `~/components/ui/skeleton`) whose **shape, count, and approximate dimensions** match the real content. No spinners. No "Loading..." text. No empty containers that pop content in.

## Detect the fetch sites

Read the route file and any components it renders directly. Flag every one of these:

- `useSuspenseQuery(...)` — needs an enclosing `<Suspense fallback={<...Skeleton />}>` boundary.
- `useQuery(...)` — needs an `if (query.isPending) return <...Skeleton />` branch (or `isLoading` for queries without `enabled: false`).
- `createFileRoute(...).loader = async ...` — needs `pendingComponent: () => <...Skeleton />` on the route options, and `defaultPendingComponent` is **not** a substitute (it's a global fallback, not a layout-matching skeleton).
- Any `await` on a server function (`src/fn/...`) inside a component that isn't already wrapped above.

If the route has **multiple independently-fetched sections** (e.g., header user, sidebar list, main content), each one gets its own `<Suspense>` boundary and its own skeleton — not one giant page-level fallback that holds the fast section hostage to the slow one.

## Shape the skeleton to the layout

For each fetch site, ask: *"What does the loaded UI look like?"* Then build a skeleton out of `<Skeleton className="..." />` blocks that occupy the same boxes:

- List of N rows → render ~N skeleton rows of the same height (use a sensible N: 5–8 for tables, 3 for cards).
- Card with avatar + title + 2 lines → circle skeleton + title-width skeleton + two line-width skeletons.
- Heading + paragraph → tall-ish skeleton + 2–3 line skeletons of varying widths.
- Reuse existing `*Skeleton` components in `src/components/` if one already matches; only create a new colocated `XxxSkeleton` component when the shape is non-trivial or reused.

Preserve the real layout's wrapper elements (grid, flex, padding, spacing) so there is no layout shift on hydration.

## NEVER

- **NEVER use a spinner, `<Loader2 />`, or "Loading..." text as the primary loading state for route-level data — and don't skip the skeleton because "the query is fast in dev"**
  **Instead:** Render `<Skeleton />` blocks that mirror the loaded layout. Add it even when local fetches feel instant.
  **Why:** Spinners hide the page structure, cause layout shift when content arrives, and feel slower than skeletons that anchor the user's eye to where content will appear. Local fetches are near-instant; users on cold caches and flaky networks see the gap that the developer doesn't.

- **NEVER call `useSuspenseQuery` without an enclosing `<Suspense fallback={...}>` boundary in the same route**
  **Instead:** Wrap the consuming component in `<Suspense fallback={<XxxSkeleton />}>` at the closest layout point that owns the slot — e.g., wrap `<UserCard />` directly, not `<RouteLayout />`.
  **Why:** Without a local boundary, suspension bubbles up to the router's default fallback (or the nearest ancestor), flashing the entire page or app shell instead of just the loading region.

- **NEVER use a single page-level skeleton when sections fetch independently**
  **Instead:** Give each independently-fetched section its own `<Suspense>` + matching skeleton, so fast sections render immediately.
  **Why:** A single boundary serializes the user's perception to the slowest query and wastes the parallelism React Query/Suspense already gives you.

- **NEVER ship a generic rectangle skeleton ("one big `<Skeleton className="h-96 w-full" />`") for a structured layout**
  **Instead:** Decompose into the boxes the real content occupies — rows, avatars, headings, paragraph lines.
  **Why:** A generic blob causes layout shift when real content paints and provides no preview of structure, defeating the point of a skeleton.

- **NEVER rely on `defaultPendingComponent` (the router-wide fallback) as the skeleton for a route with a `loader`**
  **Instead:** Set `pendingComponent` on `createFileRoute({...})` to a route-specific skeleton component that mirrors *this* route's layout.
  **Why:** The default is a generic stand-in — it cannot match per-route layout, so the user sees CLS and a non-anchoring placeholder.

## Trigger question

Before reporting the route done, ask: *"On a cold load with a slow network, what does the user see in each region of this page during the first second?"* Every answer must be "a skeleton shaped like the real content." If any answer is "blank," "spinner," or "Loading...", fix it before finishing.
