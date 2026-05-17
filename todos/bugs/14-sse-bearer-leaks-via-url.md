# [MEDIUM] SSE bearer in `?token=` URL leaks to DevTools, crash dumps, and local logs

**Files:** `src/lib/use-events.ts:22`, `src/server/api-router.ts:69-71`, `src/server/controllers/events.controller.ts`
**Category:** Credential disclosure (local surface)
**Severity:** Medium
**Surfaced by:** reviewer-security-regression on bug 03 fix (2026-05-16)

## What's wrong

`/api/events` (SSE) accepts the bearer in `?token=<token>` because `EventSource` cannot send custom headers. The URL is reissued on every reconnect (`use-events.ts` retries every 1.5s on error, see `:31`) and ends up in:

- **Chromium DevTools → Network panel** — visible verbatim in the URL column and the request copy-as-cURL.
- **`chrome://net-export` and `--enable-logging` captures** — full URL dumps.
- **Renderer-process crash dumps** — `webContents` retains last-loaded URLs.
- **macOS Console.app / `~/Library/Logs/MissionControl/main.log`** when a Node-side error stringifies `req` (we mitigated this in `server-runner.mjs` and `vite-api-plugin.ts`, but any future code path that logs `req.url` would re-introduce it).

Since the bearer is the **sole** HTTP authenticator (see comment in `auth.ts:5`), a single DevTools screenshot or crash report shared by a user is a full compromise of their local API.

## Why fixing this is important — what could go wrong

- **Bug reports / screen shares:** A user filing a bug ("DevTools shows weird errors, here's a screenshot of Network tab") leaks their bearer to anyone who reads the issue, indefinitely (token doesn't rotate automatically).
- **Crash uploads:** If MC ever adopts Sentry / electron-log crash uploads, the renderer crash dump containing the SSE URL ships off the machine.
- **Local privilege escalation:** Another process on the same machine that can read the user's Library/Logs directory or Chromium's per-profile crash dumps recovers the bearer.

This is "local surface" rather than "network surface" — the same-origin gate + loopback bind keep cross-origin pages out — but the *blast radius of any local read* is now full API authority.

## How to fix it

The fix shape is to keep the long-lived bearer out of URLs. Two approaches in increasing investment:

### Option A (preferred): per-window short-lived SSE ticket

1. Add `POST /api/events/ticket` — authenticated by the normal `Authorization: Bearer …` header. Returns `{ ticket: string, expiresAt: number }` where `ticket` is a single-use 32-byte hex string with a short TTL (e.g. 30s). Store the ticket → expiry in a Map keyed by ticket.
2. `/api/events` accepts `?ticket=<ticket>` (replaces the `?token=` path). On accept, the ticket is **consumed** (single-use) so the URL in DevTools is dead within seconds of issuance.
3. `src/lib/use-events.ts` calls `api.requestSseTicket()` (which goes through the normal authed `req<T>`) before each `new EventSource()`. On reconnect, fetch a fresh ticket.
4. Remove the `?token=` accept path from `src/server/api-router.ts:69-71`. Delete `requireBearerTokenValue` if no other caller remains.

### Option B (minimal): document the leak and rely on rotation

If A is out of scope, at least:
1. Add a prominent comment in `src/lib/use-events.ts` and on the `/api/events` route warning that the URL is *not* a forever-safe location for the token.
2. Surface a "rotate token" button more prominently in `ApiSettingsPage` with copy that explains "rotate this if you've shared a DevTools screenshot."
3. Add a regression test asserting the URL pattern in `use-events.ts` so a future refactor that switches to a more permanent surface (e.g. localStorage) is caught.

### Auxiliary hardening (independent of A vs B)

- `cache-control: no-store` is already set on the SSE response (`events.controller.ts:36-38`) — keep it.
- Audit any future request-error logging on the Node http server (`server.on("clientError", …)`, middleware error handlers) to ensure URLs are redacted via the same `/([?&])token=[^&#]+/gi` pattern used in `server-runner.mjs` and `vite-api-plugin.ts`.
