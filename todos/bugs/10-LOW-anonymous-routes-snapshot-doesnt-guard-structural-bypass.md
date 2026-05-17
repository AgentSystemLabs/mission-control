# [LOW] `ANONYMOUS_ROUTES` snapshot test guards the array but not the gate's structural placement

**Files:** `src/server/api-router.ts:39-51` (allow-list + central gate), `src/server/__tests__/api-auth.test.ts:97-99` (snapshot)
**Category:** Auth bypass — defense-in-depth gap in CI guard
**Severity:** Low
**Surfaced by:** reviewer-authz on bug 03 fix (2026-05-16)

## What's wrong

The CI guard for auth-bypass regressions today is one snapshot assertion:

```ts
// src/server/__tests__/api-auth.test.ts:97-99
it("anonymous allow-list is empty (every /api/* requires bearer)", () => {
  expect(ANONYMOUS_ROUTES).toEqual([]);
});
```

This catches one failure mode — someone adding an entry to `ANONYMOUS_ROUTES` to deliberately exempt a route — and would alert on it. It does **not** catch structural bypass:

- A developer could add an early-return inside `handleApiRequest` *above* the `requireApiAuth(...)` call on line 85:
  ```ts
  // hypothetical attack pattern:
  if (pathname === "/api/foo") return fooController.x();
  const origin = requireLocalOrigin(request);
  ...
  ```
- A developer could register a separate Connect-style middleware in `src/server/vite-api-plugin.ts` or `src/server.ts` that handles `/api/foo` *before* `handleApiRequest` runs.
- A developer could re-export `dispatch` and call it directly from another module, bypassing the wrapper entirely.

The doc comment on `ANONYMOUS_ROUTES` warns reviewers, but reviewers don't always grep — and the comment doesn't help an automated CI check.

## Why fixing this is important — what could go wrong

The current state is "the test will catch the obvious wrong thing." For a single-credential local-only app, this is *probably* good enough for human-scale review. The risk is **future code that wires a new entry-point path** (a second API handler, a new middleware chain, an alternate dev-mode wiring) accidentally creating a bypass that the test doesn't see.

This is defense-in-depth rather than active-vuln. Low priority but cheap to close.

## How to fix it

Three options in increasing investment, pick one:

### Option A: source-string assertion

Add a test that parses `handleApiRequest.toString()` and asserts that the literal `requireApiAuth(` appears before any `Controller.` identifier in the function body. Catches the early-return-above-the-gate pattern.

```ts
it("requireApiAuth is structurally placed before any controller dispatch", () => {
  const src = handleApiRequest.toString();
  const authIdx = src.indexOf("requireApiAuth(");
  const ctrlMatch = src.match(/[a-z]+Controller\./);
  expect(authIdx).toBeGreaterThan(-1);
  if (ctrlMatch) expect(authIdx).toBeLessThan(ctrlMatch.index!);
});
```

Brittle to minifier renames but production code in this repo isn't minified for test runs. Catches the most obvious bypass shape.

### Option B (preferred): make the gate structurally inescapable

Refactor the dispatch flow so the auth gate is *the* function and `dispatch` is what it calls. Then there's no way to reach `dispatch` without going through the gate:

```ts
// src/server/api-router.ts
const protectedDispatch = withAuth(dispatch);

export async function handleApiRequest(request: Request): Promise<Response | null> {
  // ... origin check ...
  return await protectedDispatch(request, url, method, pathname);
}

function withAuth(fn: typeof dispatch) {
  return async (request: Request, url: URL, method: string, pathname: string) => {
    const auth = requireApiAuth(request, url, method, pathname);
    if (!auth.ok) return auth.response;
    return fn(request, url, method, pathname);
  };
}
```

Now `dispatch` is unreachable from outside this module *and* the only thing inside this module that calls it is `protectedDispatch`. A bypass requires editing the HOF wrapper, which is one focused review surface.

### Option C: route-table introspection

Move the route table to a declarative array (`{ method, pathname, handler, anonymous: false }`) and have `dispatch` be a thin lookup. Then the test can iterate the table and assert every entry has `anonymous: false` unless on the snapshot allow-list. Biggest refactor; pairs naturally with future API-doc generation.

## Cross-references

- `src/server/__tests__/api-auth.test.ts` already exercises the gate on ~40 representative routes via behavioral assertions ("without bearer → 401"). That coverage holds today but only for routes the test enumerates; the structural guard above would catch the case where a *new* route is added without a corresponding test entry.
- Related: bug 15 (dispatch catch echoes err.message) — both are about regression-magnet patterns in `handleApiRequest`.
