---
name: audit-authz
description: Audit authorization on every server-side entry point — TanStack Start server functions in `src/fn/`, HTTP route handlers, tRPC procedures, GraphQL resolvers, webhook handlers, queue workers, IPC handlers — for missing or wrong access checks. Detects: handlers with no auth check at all (anonymous access), handlers that check identity but not ownership (any logged-in user can read another user's data), handlers that grant by role-presence without resource scoping, IDOR (raw id from request body trusted without ownership lookup), public endpoints reading user-scoped data via session, and admin-route checks that depend on a client-supplied flag. Reports findings with severity (critical / high / medium) and the specific check that's missing. Never silently inserts checks — proposes the fix and lets the user confirm. Trigger phrases — "audit auth", "authz audit", "check authorization", "/audit-authz", "any auth holes", "review server functions for auth", "permission audit", "IDOR check". Skip for — pure frontend code, public-by-design endpoints (health, status, public read APIs explicitly marked), test fixtures.
---

# Code Audit Authz

Every server entry point answers two questions: **who is this** (authentication) and **what may they do with the resource they named** (authorization). The bug class this skill targets is the second — present session, missing ownership.

---

## Phase 1 — Enumerate Entry Points

Find every server-side handler. By convention in this stack:

- `src/fn/**/*.ts` — TanStack Start server functions
- `src/routes/api/**/*.ts` — HTTP route handlers
- `src/routes/**/route.ts` with `loader`/`action` — server-side route handlers
- Webhook receivers (`src/routes/api/webhooks/**`)
- Queue worker handlers (`src/queues/**`, `src/workers/**`)
- Electron IPC handlers (`ipcMain.handle(...)`)

For other stacks: scan for the framework's handler decorators (`@Get`, `@Post`, Express `app.get(...)`, Hono `app.get(...)`, etc.).

Build a list. Each entry: file path, handler export name, observed input shape (params/body/query/message).

**Exit:** all handlers enumerated.

---

## Phase 2 — Classify Each Entry Point

For each handler, classify by access requirement:

| Class | Description |
|---|---|
| **Public** | Intentionally anonymous (health check, public landing data, marketing API). |
| **Authenticated** | Any logged-in user may call it (e.g. `getCurrentUser`). |
| **User-scoped** | Requires the caller to own (or be granted access to) the resource named in the input. |
| **Admin / role-gated** | Requires a specific role beyond "logged in". |
| **Service / internal** | Called by another service; auth via shared secret, signed request, or network boundary. |

Inputs that name a resource (`postId`, `projectId`, `userId`, `orgId`, `messageId`) almost always indicate **User-scoped** unless the resource is intentionally public.

Find the project's existing auth helpers (e.g., `requireUser()`, `requireAdmin()`, `getCurrentUser()`, `assertCanAccess(post, user)`). Use those — do not invent new ones.

**Exit:** each handler has a classification + the access helper(s) it ought to call.

---

## Phase 3 — Check Each Handler

For each handler, verify the actual code matches the classification. Flag findings:

### CRITICAL — anonymous access to user-scoped data

The handler reads or mutates user-scoped data with no auth check at all. Anyone can hit it.

```
src/fn/getPost.ts:14  CRITICAL
  Handler reads a post by id with no session check.
  Classification: User-scoped (postId in input).
  Missing: requireUser() and ownership check.
```

### CRITICAL — IDOR (identity present, ownership absent)

The handler calls `requireUser()` (or equivalent) but then reads/writes a resource by id from input without verifying the user owns it.

```
src/fn/updateProject.ts:21  CRITICAL — IDOR
  requireUser() is called.
  Then: db.update(projects).set(...).where(eq(projects.id, input.projectId))
  Missing: ownership check — verify the project belongs to the user before update.
```

### HIGH — role granted but not resource-scoped

A role is checked (`requireAdmin()`) but the action targets a specific resource that admins of *one* org should not access in *another* org.

### HIGH — admin gated on client-supplied flag

```
if (input.isAdmin) { ... }   // client says they're admin
```

The flag must come from the session, not the input.

### MEDIUM — webhook with no signature verification

```
src/routes/api/webhooks/stripe.ts  MEDIUM
  Reads webhook body and updates DB; no signature verification against STRIPE_WEBHOOK_SECRET.
  Anyone who can reach the URL can forge events.
```

### MEDIUM — service endpoint with weak shared secret

A service endpoint guarded by a hardcoded token, no rotation path, or env var that's not actually checked.

### LOW — auth check happens after a side effect

The handler does a `console.log(...)`, sends an analytics event, or starts a job *before* the auth check. Information leak rather than direct vulnerability.

**Exit:** every handler is either marked OK or has a finding with severity.

---

## Phase 4 — Report

```
Authz Audit — <scope>
─────────────────────

CRITICAL (3)
  src/fn/getPost.ts:14            — anonymous access; missing requireUser + ownership
  src/fn/updateProject.ts:21      — IDOR; ownership not verified after requireUser
  src/fn/deleteOrg.ts:9           — admin gate uses input.isAdmin (client-supplied)

HIGH (1)
  src/fn/exportData.ts:33         — admin role checked, but org scoping missing

MEDIUM (2)
  src/routes/api/webhooks/stripe.ts  — no signature verification
  src/queues/processInvite.ts:8       — message body trusted without origin check

OK (24 handlers)

Total: 30 entry points, 6 findings.

Recommended fix for each finding (with code snippet using the project's existing
auth helpers). No fixes have been applied.
```

For each finding, include a concrete fix snippet using the project's existing auth helpers — not a generic example.

---

## Phase 5 — Optional: Apply Fixes

Only if the user explicitly asks ("yes, apply the critical fixes"):

- Apply one finding at a time.
- After each, run typecheck and the relevant test (if any).
- Show the diff and stop. Let the user confirm before the next finding.

Never bulk-apply. Authorization fixes change behavior — every one needs a sanity check.

---

## NEVER

- **NEVER silently insert auth checks.**
  **Instead:** report findings; apply only with explicit user approval and one at a time.
  **Why:** an auth check inserted in the wrong place either over-restricts (legitimate users get 403) or is bypassed at runtime by an earlier code path. The diff must be reviewed by someone who knows the resource model — that's the user, not the audit.

- **NEVER trust user identity claims that come from the request body or query.**
  **Instead:** the user identity must come from the session / cookie / verified JWT. `input.userId` is a target, not a credential.
  **Why:** every IDOR begins with treating client-supplied identifiers as authoritative. The session is the only source of "who is calling".

- **NEVER conclude a handler is safe because it calls `requireUser()`.**
  **Instead:** verify that for every resource named in the input, ownership is checked. `requireUser()` proves identity, not authorization.
  **Why:** identity-only checks are the most common authz bug — every logged-in user becomes able to read or modify every other user's resources by changing one id in the request.

- **NEVER mark a webhook handler safe because it parses the payload with zod.**
  **Instead:** verify it also validates the request signature against the provider's secret (`stripe-signature`, `x-hub-signature-256`, custom HMAC).
  **Why:** zod proves the body shape is well-formed; it does not prove the request came from the legitimate sender. Without a signature check, anyone who knows the URL can forge events.

- **NEVER reason about authorization from the UI.**
  **Instead:** the audit examines server code only. Client-side hiding is not a security control.
  **Why:** the UI shipping or hiding a button changes nothing about who can call the endpoint. A skill that gets distracted by UI gates produces a false sense of safety on real holes.

- **NEVER skip handlers that "look like internal/test routes".**
  **Instead:** internal-looking routes are a common breach vector. Verify the auth model explicitly — even `/internal/*` paths.
  **Why:** "internal" is a deployment claim, not an enforced one. Many breaches start with an "internal" admin endpoint that turned out to be reachable from the public network.

- **NEVER recommend a fix that uses a helper not already in the codebase.**
  **Instead:** find and use the project's existing auth helper. If none exists, surface that as a separate finding and stop — do not invent one.
  **Why:** ad hoc auth helpers fragment the audit surface. The project has either a single helper that's reviewed once or N inconsistent ones — the audit's job is to push the codebase toward the former, not to add another.
