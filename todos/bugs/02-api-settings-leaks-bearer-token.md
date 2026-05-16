# [CRITICAL] `GET /api/settings` leaks the API bearer token anonymously

**Files:** `src/server/api-router.ts:320-347`
**Category:** Credential disclosure / auth bypass
**Severity:** Critical

## What's wrong

`settingsPayload()` returns `apiToken: getOrCreateApiToken()` (`api-router.ts:326`) and the `GET /api/settings` branch (`api-router.ts:340`) is reachable with **no authentication**.

`POST /api/settings { regenerate: true }` rotates the token — also anonymous, and the response echoes the freshly minted token.

The three routes that *do* enforce auth (`POST /api/projects/:id/tasks` at `api-router.ts:145`, `POST /api/tasks/:id/status` at `api-router.ts:203`, `POST /api/hooks/:name` at `api-router.ts:478`) only check the bearer token — the same token any caller can fetch anonymously.

## Why fixing this is important — what could go wrong

The bearer token is the entire authorization model. Leaking it makes the "protected" routes no more protected than the anonymous ones:

- An attacker page reads `GET /api/settings` (cross-origin SOP normally blocks the response — but DNS rebinding from finding 01 makes the origin match) and now has full API authority.
- `POST /api/settings { regenerate: true }` lets the attacker rotate the token then read it back — locking the legitimate UI out, or fixating a known value.
- The hook endpoint (`POST /api/hooks/:name`) triggers `generateTitleForTask` which spawns `claude -p` via the user's login shell. With the token in hand, the attacker drives synthetic agent invocations.

Combined with finding 01, this collapses the app's entire auth tier — there is effectively no privileged path.

## How to fix it

1. Stop returning `apiToken` from `GET /api/settings`. Strip it from the response shape in `settingsPayload()`.
2. Move token delivery to Electron IPC only — add an `ipcMain.handle('settings:getToken', ...)` in `electron/main.ts` and have the renderer load the token via `window.electronAPI.settings.getToken()` in `src/lib/api.ts`. The token never crosses HTTP.
3. Require auth (or, once finding 01 lands, just same-origin) on `POST /api/settings { regenerate: true }` so an attacker can't rotate it either.
4. Audit the renderer for any other site that fetches the token over HTTP and migrate them to IPC.
