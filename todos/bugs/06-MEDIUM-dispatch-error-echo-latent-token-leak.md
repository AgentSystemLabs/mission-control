# [MEDIUM] `handleApiRequest` catch echoes `err.message` to 400 responses (latent `?token=` leak)

**Files:** `src/server/api-router.ts:88-93`
**Category:** Information disclosure (latent / regression magnet)
**Severity:** Medium
**Surfaced by:** reviewer-authz + reviewer-security-regression on bug 03 fix (2026-05-16)

## What's wrong

```ts
// src/server/api-router.ts:88-93
try {
  return await dispatch(request, url, method, pathname);
} catch (err: any) {
  const message = err?.message || "bad request";
  return jsonError(400, message);
}
```

Two problems:

1. **Maps everything to 400** — even genuine 500s (a downstream service throwing an unexpected error, a Node-level fault, an assertion failure). Callers can't tell the difference between "you sent bad JSON" and "the server is broken."
2. **Forwards `err.message` verbatim to the response body** — today no thrown error in `dispatch` reconstructs the request URL (and `/api/events` SSE bypasses `dispatch` entirely, so the only URL containing `?token=` never reaches this catch). But:
   - A future controller that wraps `fetch` errors (`Error("upstream failed: " + url)`) and surfaces those to the user could trivially round-trip a `?token=` value if the URL is reconstructed.
   - A future controller that includes user-supplied query-string fragments in zod issue paths or error messages can do the same.
   - Any future internal HTTP self-call that goes through `req<T>` with a constructed URL containing `?token=` (e.g. internal hop to `/api/events` for testing) would leak via this path.

This is **latent, not active** — but the cost of fixing is small and the cost of regressing is total (every authenticated caller's bearer flows back to the same caller on error, which sounds safe right up until the error path runs in a renderer with a cross-context content-script).

## Why fixing this is important — what could go wrong

- A future contributor adds `throw new Error(\`failed to fetch \${url.toString()}\`)` in any controller. The URL — including any `?token=` query param the request happened to carry — round-trips in the 400 body.
- 400-for-everything also hides real 500s in monitoring: if MC ever wires Sentry / electron-log uploads, every server bug looks like a client-side input error and gets filtered out of the "real issues" bucket.

## How to fix it

Two-line change with a small helper. Pattern mirrors the existing `handleDomainError` in `src/server/controllers/_helpers.ts`:

```ts
// src/server/api-router.ts
try {
  return await dispatch(request, url, method, pathname);
} catch (err: any) {
  // Only echo error messages that are intentionally caller-facing.
  // Everything else is a server bug — log it, return generic 500.
  if (err?.name === "ZodError" || err?.expose === true) {
    return jsonError(400, err.message);
  }
  console.error(
    `[api] unhandled in dispatch ${method} ${pathname}:`,
    err,
  );
  return jsonError(500, "internal error");
}
```

Then have controllers that *intentionally* surface their own message tag the error: `const e = new Error("bad input"); (e as any).expose = true; throw e;` — or use a dedicated `BadRequestError` subclass.

For defense-in-depth, also strip `?token=` substrings from any string before it reaches `jsonError`:

```ts
function redactToken(s: string): string {
  return s.replace(/([?&])token=[^&#\s"']+/gi, "$1token=<redacted>");
}
```

Use this in both the log line and the optional 400 message.

## Cross-references

- The redaction pattern is already in use in `electron/server-runner.mjs` and `src/server/vite-api-plugin.ts` (introduced as part of bug 03 fix). Extracting it into a shared helper would also satisfy the duplication smell those two files now carry.
- The `/api/events` SSE controller (`src/server/controllers/events.controller.ts`) does NOT route through `dispatch`'s catch (it returns the stream directly), so the active SSE-URL-in-error-body vector is empty today. This finding is purely about future-proofing.
