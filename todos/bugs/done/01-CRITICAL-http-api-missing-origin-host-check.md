# [CRITICAL] HTTP API has no Origin / Host validation

**Files:** `src/server/api-router.ts` (entry: `handleApiRequestInner`), `electron/server-runner.mjs`, `electron/main.ts:78-116`
**Category:** Auth bypass / CSRF / DNS rebinding
**Severity:** Critical

## What's wrong

The local API server binds to `127.0.0.1:<random>` (`electron/main.ts:78-116`, `electron/server-runner.mjs:115`). The router (`src/server/api-router.ts`) never checks:

- `Origin`
- `Host`
- `Sec-Fetch-Site`
- a CSRF token

Any TCP client that can reach the runtime port is treated as the local UI. Browsers happily send fetches to `http://127.0.0.1:<port>` from any tab the user has open.

## Why fixing this is important — what could go wrong

Any website the user visits can drive your local app:

1. The attacker page scans `127.0.0.1` for the runtime port (16-bit, sweepable in seconds; an unauthenticated probe to `GET /api/settings` is a perfect fingerprint).
2. With **DNS rebinding** (`evil.tld` resolves to a real IP for the first request, then re-resolves to `127.0.0.1`), the page becomes same-origin with your localhost server — the browser will let it *read* responses, not just write fire-and-forget POSTs.
3. From that point every anonymous route is reachable: project create/delete, git commit/push, file delete, terminal-command write, license swap, keybinding overwrite, plus the SSE event stream (full activity timeline exfil). See findings 02 and 03 for the cascade.

This is the root cause that makes most of the other findings exploitable from the open internet rather than only from a locally compromised renderer.

## How to fix it

1. Add a `requireSameOrigin(request)` helper next to `src/server/auth.ts`. It should:
   - Pull the request's `Origin` (fall back to `Host` when `Origin` is absent — e.g. SSE / direct navigations).
   - Compare against an explicit allowlist: `http://127.0.0.1:<runtimePort>` and `http://localhost:<runtimePort>`. In dev, also allow the Vite origin (`http://127.0.0.1:5173`).
   - Reject with `403` otherwise.
2. Call it at the top of `handleApiRequestInner` in `src/server/api-router.ts` so every `/api/*` route inherits the check.
3. The runtime port is already known to the main process via `pickPort()` (`electron/main.ts:79`). Pass it into the API handler factory so the same-origin helper can build the allowlist.

This single change neutralises DNS rebinding (browser sends the rebound hostname in `Host`) and ordinary cross-origin browser fetches in one shot.
