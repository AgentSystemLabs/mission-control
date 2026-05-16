# [HIGH] Bearer token compared with non-constant-time `!==`

**Files:** `src/server/auth.ts:7`
**Category:** Timing oracle on auth credential
**Severity:** High (low priority — strictly dominated by finding 02, which makes the token anonymously readable)

## What's wrong

```ts
if (!token || token !== expected) { ... reject ... }
```

`!==` short-circuits on the first mismatched character, leaking the matching-prefix length via response timing. The token is a 32-hex string used as the only credential for the three otherwise-protected routes (`POST /api/projects/:id/tasks`, `POST /api/tasks/:id/status`, `POST /api/hooks/:name`).

## Why fixing this is important — what could go wrong

A local same-machine attacker (another logged-in user, or any process that can open a TCP connection to the runtime port — the port number is written to `<userData>/.port`, which is world-readable by default on macOS/Linux home dirs) can mount a per-byte timing attack across many requests to recover the token without ever needing to read it.

In practice this is dwarfed by finding 02 (the token is anonymously readable from `GET /api/settings` over loopback). Fix that first. But constant-time comparison is a one-line change and removes a separate side-channel that survives even if you ever harden `GET /api/settings`.

## How to fix it

In `src/server/auth.ts:7`:

```ts
import { timingSafeEqual } from "node:crypto";

function tokensMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// then:
if (!token || !tokensMatch(token, expected)) { ... reject ... }
```

The length-mismatch short-circuit is fine: token length isn't secret (it's a fixed 32-hex constant).
