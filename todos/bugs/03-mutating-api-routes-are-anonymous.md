# [CRITICAL] Almost every mutating API route is anonymous

**Files:** `src/server/api-router.ts` (handler: `handleApiRequestInner`)
**Category:** Auth bypass / IDOR-equivalent for a single-user app
**Severity:** Critical

## What's wrong

The router gates exactly three endpoints behind `requireBearerToken`:

- `POST /api/projects/:id/tasks` (`api-router.ts:145`)
- `POST /api/tasks/:id/status` (`api-router.ts:203`)
- `POST /api/hooks/:name` (`api-router.ts:478`)

**Every other mutating route is anonymous**, including:

- `POST /api/projects`, `PATCH/DELETE /api/projects/:id` — create/edit/delete projects, including the on-disk `path` (`api-router.ts:88-138`)
- `DELETE /api/projects/:id/file?path=...` — delete files inside a project (`api-router.ts:228-241`)
- `POST /api/projects/:id/git/{stage,unstage,commit,push}` (`api-router.ts:243-283`)
- `POST /api/projects/:id/user-terminals`, `PATCH/DELETE /api/user-terminals/:id` — `startCommand` is the command the next PTY runs (`api-router.ts:285-318`)
- `POST /api/groups`, `PATCH/DELETE /api/groups/:id`
- `PATCH/DELETE /api/tasks/:id`, `POST /api/tasks/:id/archive|restore`
- `POST /api/settings` (including `{ regenerate: true }`)
- `POST /api/license/validate`, `DELETE /api/license`
- `POST /api/skills/install`, `POST /api/launch-kit/projects` (covered in dedicated findings 07/08)
- `PUT/DELETE /api/keybindings` (`api-router.ts:446-474`)
- `GET /api/events` — SSE stream of every internal event (`api-router.ts:540-578`) — leaks the full project layout, task titles, and activity timeline

## Why fixing this is important — what could go wrong

Combined with finding 01 (no Origin/Host check), any web page can drive the full mutating surface:

- **Project hijack:** `POST /api/projects` adds a fake project pointed at `/Users/victim`. Subsequent calls can git-commit/push attacker content from that path.
- **Persistent code execution:** `POST /api/projects/:id/user-terminals` writes an attacker-chosen `startCommand` (`pty.spawn` runs it verbatim — see finding 05). Next time the user opens that terminal in MC, the command runs.
- **Silent file destruction:** `DELETE /api/projects/:id/file?path=src/index.ts`.
- **License swap:** `DELETE /api/license` downgrades the user to the Free-tier cap; `POST /api/license/validate` installs an attacker-supplied key, which is then sent as a `Bearer` to `academy.agentsystemlabs.com` (see `src/server/services/install-skills.ts:42`) — turning the user's app into a fetch client carrying an attacker credential.
- **Persistent hotkey hijack:** `PUT /api/keybindings` overwrites every binding; persists across launches.
- **Activity exfil:** `GET /api/events` streams every project/task event, indefinitely.

Even *read*-only routes leak meaningfully (`GET /api/projects` returns absolute filesystem paths; `GET /api/usage` returns token totals) — anonymous, cross-origin-readable under DNS rebinding.

## How to fix it

1. Invert the allow-list. After landing the same-origin helper from finding 01, also call `requireBearerToken` at the top of `handleApiRequestInner` for every method except `GET` to whitelisted public endpoints.
2. Explicitly opt routes *out* of auth only when there's a concrete reason (e.g. an unauthenticated readiness probe).
3. Per-route review: walk the router top-to-bottom and confirm each route either has `requireBearerToken` or is on the explicit anonymous list.
4. Add a typecheck-time guard: a small linter/test that scans `api-router.ts` for `handleMatch(...)` blocks not preceded by `requireBearerToken` and fails CI for any new addition that isn't on the explicit allow-list.
