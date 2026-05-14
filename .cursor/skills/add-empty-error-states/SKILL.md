---
name: add-empty-error-states
description: Sibling to add-skeleton-loaders. After data fetching is wired in a route or component, verify and auto-fix the two non-loading states most often forgotten — empty (the request succeeded but returned zero items / null) and error (the request failed). Empty states get a clear message + primary call-to-action. Error states get a human-readable message + retry affordance + (in dev) a way to surface the actual error. Uses the project's existing UI primitives — shadcn `<EmptyState />` if present, project conventions otherwise. Does NOT cover loading skeletons. Trigger phrases — "add empty state", "what if this list is empty", "add error state", "handle the error case", "/add-empty-error-states", "error UI", "no results UI", any time a route was just wired with `useQuery` / `useSuspenseQuery` / loader. Skip for — pure static pages, mutations (useMutation has different patterns), modals/dialogs whose empty state is the parent's responsibility.
---

# Add Empty / Error States

A page in three states: loading, empty, error. The fast-path "data shows up" gets all the design attention; the other two get inherited from whatever the renderer falls back to. This skill catches both.

---

## Phase 1 — Locate Data-Fetching Surfaces

In the file the user names (or the most recently edited route/component), find every:

- `useQuery(...)` / `useSuspenseQuery(...)` (TanStack Query)
- Route `loader` returning data the component reads
- `useFetcher` / `useLoaderData`
- Direct fetch + state (less common; flag if found)

For each, identify what's rendered with the result. The empty/error treatment goes wherever that result is consumed.

**Exit:** every data-fetch surface and its render site are listed.

---

## Phase 2 — Per Fetch: Check the Three Branches

For each fetch, verify the component handles all three of:

| Branch | Trigger | Treatment |
|---|---|---|
| Loading | first render before data resolves | Skeleton (handled by add-skeleton-loaders, out of scope here). |
| Empty | data resolved but is `null`, `undefined`, `[]`, or otherwise represents "nothing" | Empty state UI. |
| Error | query/loader threw or returned an error | Error state UI. |

For TanStack Query: check that `query.isPending` / `query.isError` / `query.data` are all reachable in the render. With `useSuspenseQuery`, errors are caught by the nearest `<ErrorBoundary>` and loading by `<Suspense>` — verify both boundaries exist on the route.

For loaders: check the route's `errorComponent` (TanStack Router) or equivalent; check `pendingComponent` for loading; the empty case must be handled in the route component itself.

**Exit:** for each fetch, mark Empty and Error as `OK`, `MISSING`, or `WEAK`.

---

## Phase 3 — Detect UI Primitives

Search the codebase for an existing empty/error component:

- `<EmptyState>` / `EmptyState.tsx` — shadcn-style pattern, common in this stack.
- Custom `<NoResults>` / `<ErrorBoundary>` / `<Empty>`.
- A pattern: a card with an icon, heading, body, and action button.

If a primitive exists, use it. If not, propose the smallest one that matches the project's component style — but flag this as a structural decision and let the user confirm before creating shared components.

**Exit:** for each missing/weak state, the component to use is identified.

---

## Phase 4 — Apply Fixes

For each MISSING or WEAK state, apply the inline fix:

### Empty state pattern

```tsx
const { data: posts } = useQuery(postsQueryOptions())

if (posts.length === 0) {
  return (
    <EmptyState
      icon={FileTextIcon}
      title="No posts yet"
      description="Create your first post to get started."
      action={
        <Button asChild>
          <Link to="/posts/new">New post</Link>
        </Button>
      }
    />
  )
}
```

The empty state must:
- Tell the user *what's empty* (specific to this surface — "No posts" not "No items").
- Tell the user *what to do* if action is available (CTA button), or explain *why it's empty* if no action applies.
- Use the same icon/spacing as other empty states in the codebase.

If the empty state means "nothing yet, never will be without action" → lead with the action. If it means "you've filtered everything out" → lead with "clear filters".

### Error state pattern

```tsx
if (query.isError) {
  return (
    <ErrorState
      title="Couldn't load posts"
      description="Something went wrong. Try again in a moment."
      action={<Button onClick={() => query.refetch()}>Retry</Button>}
      // In dev, surface the actual error:
      details={import.meta.env.DEV ? String(query.error) : undefined}
    />
  )
}
```

The error state must:
- Use a human message — never raw `error.message` to end users (often a stack trace or technical noise).
- Provide a retry affordance whenever the operation is retry-safe.
- Surface the actual error in dev mode (helps the developer; gated so it doesn't ship to users).

If the route is using `useSuspenseQuery`, place the error UI in the route's `errorComponent` (or a `<ErrorBoundary>` wrapping the suspense boundary), not in the component body.

**Exit:** each previously MISSING/WEAK state is now OK.

---

## Phase 5 — Verify

Render the route in the dev browser at three states (the user does this; report the steps):

1. **Empty:** truncate the query result (e.g., temporarily `where(eq(posts.id, '__never__'))`) or use a fresh test user with no data.
2. **Error:** force the loader/query to throw (temporary `throw new Error('test')` in the server fn) — confirm the error state renders, retry works after removing the throw.
3. **Happy path:** with normal data, confirm the new states do not render.

**Exit:** the report includes the manual verification steps; the user is told to run them.

---

## Phase 6 — Report

```
Empty/error states added in: <file>

  <component name>
    Empty state: ✓ added — uses <EmptyState> with <CTA>
    Error state: ✓ added — uses <ErrorState> with retry

Verify by:
  1. Trigger empty: <how>
  2. Trigger error: <how>
  3. Confirm happy path still renders normally.
```

---

## NEVER

- **NEVER show raw `error.message` to end users in the rendered error state.**
  **Instead:** a human-readable message like "Couldn't load posts. Try again in a moment." Surface the raw error only in dev (`import.meta.env.DEV`) or behind a developer-only toggle.
  **Why:** raw errors are usually stack traces or technical strings ("ECONNRESET", "23505: duplicate key value violates unique constraint…"). Showing them confuses users and leaks internal details to anyone who can hit the URL.

- **NEVER use a generic "Something went wrong" everywhere.**
  **Instead:** specific to the surface — "Couldn't load posts" / "Couldn't save draft" / "Couldn't load comments". Name the thing that failed.
  **Why:** generic messages make every error feel the same. A specific message lets the user understand the scope: "the comments didn't load but the post is fine" is reassuring and actionable; "Something went wrong" is not.

- **NEVER omit the retry affordance on a retry-safe error.**
  **Instead:** include a Retry button that calls `query.refetch()` (or the loader's reload). Skip retry only on explicitly non-retry-safe errors (4xx that the user must fix themselves).
  **Why:** the most common cause of an error is a transient network blip. Without retry, the user reloads the whole page; with retry, they continue what they were doing.

- **NEVER render an empty state that's just "No results."**
  **Instead:** name what's empty and (when applicable) tell the user how to fix it: "No posts yet — create your first one" or "No matching results — clear filters to see all posts."
  **Why:** "No results" without context leaves the user wondering whether the page is broken, the filter is too narrow, or they actually have nothing. Specific copy answers the question.

- **NEVER place the error UI inside `useSuspenseQuery`'s consumer — it never runs there.**
  **Instead:** put it in the route's `errorComponent` or a `<ErrorBoundary>` wrapping the suspense boundary.
  **Why:** suspense queries throw on error; the throw bubbles up past your component to the nearest error boundary. Code in the consumer that checks `query.isError` is unreachable.

- **NEVER conflate "empty" with "loading".**
  **Instead:** check the loading branch first (`isPending` / suspense), only then check empty (`data.length === 0`). The order matters because data is `undefined` while loading.
  **Why:** if empty is checked first, every loading state flashes the empty UI for one frame before the real data arrives. Users perceive this as "broken page that fixed itself" — worse than just showing a skeleton.

- **NEVER add a third UI primitive when the project already has an empty/error component pattern.**
  **Instead:** find and reuse the existing `EmptyState` / `ErrorState` / equivalent.
  **Why:** duplicate primitives fragment the design system. Reviewers waste cycles deciding which to use; users see inconsistent UI.
