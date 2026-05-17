# Security audit findings

Generated 2026-05-16 from a full-codebase security pass (Electron main + IPC, local HTTP server, services). Items 14–17 added 2026-05-16 by reviewer-authz / reviewer-security-regression / reviewer-contracts during the bug 03 fix.

Each `.md` in this directory is one finding with the affected files, what could go wrong, and how to fix it.

## Fix order (highest leverage first)

| # | File | Severity | Notes |
|---|---|---|---|
| 1 | [done/01-http-api-missing-origin-host-check.md](done/01-http-api-missing-origin-host-check.md) | CRITICAL ✅ | Root cause — kills DNS rebinding + cross-origin reach in one helper |
| 2 | [done/02-api-settings-leaks-bearer-token.md](done/02-api-settings-leaks-bearer-token.md) | CRITICAL ✅ | Token is anonymously readable; the "protected" routes aren't |
| 3 | [done/03-mutating-api-routes-are-anonymous.md](done/03-mutating-api-routes-are-anonymous.md) | CRITICAL ✅ | Invert the allow-list: require auth on every mutating route |
| 4 | [done/04-ipc-no-sender-attestation.md](done/04-ipc-no-sender-attestation.md) | CRITICAL ✅ | `safeHandle` wrapper around every `ipcMain.handle` |
| 5 | [05-pty-spawn-arbitrary-command-execution.md](05-pty-spawn-arbitrary-command-execution.md) | CRITICAL | Allowlist binaries; confine `cwd`; skip `sh -c` |
| 6 | [06-files-write-can-plant-agent-hooks.md](06-files-write-can-plant-agent-hooks.md) | CRITICAL | Path/extension deny-list inside `filesWrite` |
| 7 | [07-skills-install-writes-anywhere.md](07-skills-install-writes-anywhere.md) | CRITICAL | Require auth; confine `projectPath` to known projects |
| 8 | [08-launch-kit-writes-anywhere.md](08-launch-kit-writes-anywhere.md) | CRITICAL | Require auth; confine `parentDir` to a small allow-list |
| 9 | [09-shell-openpath-arbitrary-execution.md](09-shell-openpath-arbitrary-execution.md) | HIGH | Extension deny-list + project-root confinement |
| 10 | [10-pty-mcenv-ssrf-and-token-exfil.md](10-pty-mcenv-ssrf-and-token-exfil.md) | HIGH | Drop renderer-supplied `mcEnv`; use main-process values |
| 11 | [11-install-agent-hooks-cwd-not-validated.md](11-install-agent-hooks-cwd-not-validated.md) | HIGH | Subsumed by finding 5's `cwd` validation |
| 12 | [12-missing-permission-request-handler.md](12-missing-permission-request-handler.md) | HIGH | `setPermissionRequestHandler(() => deny)` |
| 13 | [13-bearer-token-non-constant-time-compare.md](13-bearer-token-non-constant-time-compare.md) | HIGH | `crypto.timingSafeEqual` (cleanup, low priority once #2 lands) |
| 14 | [14-sse-bearer-leaks-via-url.md](14-sse-bearer-leaks-via-url.md) | MEDIUM | SSE bearer in `?token=` → DevTools, crash dumps, shared screenshots. Per-window short-lived ticket flow. |
| 15 | [15-dispatch-error-echo-latent-token-leak.md](15-dispatch-error-echo-latent-token-leak.md) | MEDIUM | `handleApiRequest` catch echoes `err.message` to 400 body — latent `?token=` leak; map unhandled to generic 500. |
| 16 | [16-anonymous-routes-snapshot-doesnt-guard-structural-bypass.md](16-anonymous-routes-snapshot-doesnt-guard-structural-bypass.md) | LOW | `ANONYMOUS_ROUTES = []` snapshot doesn't catch a structural bypass above the central gate; wrap dispatch in `withAuth(...)`. |
| 17 | [17-bundler-visible-dynamic-import-server-leak-risk.md](17-bundler-visible-dynamic-import-server-leak-risk.md) | LOW | `await import("~/server/auth")` in `src/lib/api.ts` is bundler-visible; add ESLint `no-restricted-imports` guard. |

## Two root causes drive most of this

- **HTTP root cause** (findings 1–3, plus the network half of 7/8/10): the local API server has no Origin/Host check, anonymous routes leak the bearer token, and the rest aren't gated.
- **IPC root cause** (finding 4, multiplying 5/6/9/10/11): the renderer is implicitly trusted with no `event.senderFrame` check.

Findings 14–17 are residual defense-in-depth gaps surfaced by the bug 03 fix — none are active vulnerabilities, but each is a regression magnet that an automated guard or follow-up refactor can close cheaply.
