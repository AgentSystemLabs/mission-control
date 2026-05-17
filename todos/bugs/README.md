# Security audit findings

Generated 2026-05-16 from a full-codebase security pass (Electron main + IPC, local HTTP server, services). Follow-up findings from the bug 03 and bug 05 fixes are folded into the open priority queue below.

Each `.md` in this directory is one finding with the affected files, what could go wrong, and how to fix it.

## Open fix order

| # | File | Severity | Notes |
|---|---|---|---|
| 1 | [01-HIGH-pty-spawn-agent-flags-grant-rce.md](01-HIGH-pty-spawn-agent-flags-grant-rce.md) | HIGH | Newly surfaced bug-05 follow-up; agent flags can still load attacker config |
| 2 | [02-HIGH-shell-openpath-arbitrary-execution.md](02-HIGH-shell-openpath-arbitrary-execution.md) | HIGH | Extension deny-list + project-root confinement |
| 3 | [03-HIGH-pty-mcenv-ssrf-and-token-exfil.md](03-HIGH-pty-mcenv-ssrf-and-token-exfil.md) | HIGH | Drop renderer-supplied `mcEnv`; use main-process values |
| 4 | [04-HIGH-missing-permission-request-handler.md](04-HIGH-missing-permission-request-handler.md) | HIGH | `setPermissionRequestHandler(() => deny)` |
| 5 | [05-MEDIUM-sse-bearer-leaks-via-url.md](05-MEDIUM-sse-bearer-leaks-via-url.md) | MEDIUM | Replace `?token=` with short-lived SSE tickets |
| 6 | [06-MEDIUM-dispatch-error-echo-latent-token-leak.md](06-MEDIUM-dispatch-error-echo-latent-token-leak.md) | MEDIUM | Map unhandled dispatch errors to generic 500 |
| 7 | [07-MEDIUM-spawn-policy-error-echoes-request-input.md](07-MEDIUM-spawn-policy-error-echoes-request-input.md) | MEDIUM | Newly surfaced bug-05 follow-up; avoid echoing attacker-controlled spawn input |
| 8 | [08-MEDIUM-pty-spawn-opts-not-discriminated-union.md](08-MEDIUM-pty-spawn-opts-not-discriminated-union.md) | MEDIUM | Tighten renderer IPC type contract |
| 9 | [09-MEDIUM-shell-task-agent-rejected-by-spawn-policy.md](09-MEDIUM-shell-task-agent-rejected-by-spawn-policy.md) | MEDIUM | Resolve domain enum vs runtime allow-list drift |
| 10 | [10-LOW-anonymous-routes-snapshot-doesnt-guard-structural-bypass.md](10-LOW-anonymous-routes-snapshot-doesnt-guard-structural-bypass.md) | LOW | Make the auth gate structurally inescapable |
| 11 | [11-LOW-bundler-visible-dynamic-import-server-leak-risk.md](11-LOW-bundler-visible-dynamic-import-server-leak-risk.md) | LOW | Add client/server import guard |

## Done

| # | File | Severity | Notes |
|---|---|---|---|
| 1 | [done/01-CRITICAL-http-api-missing-origin-host-check.md](done/01-CRITICAL-http-api-missing-origin-host-check.md) | CRITICAL | Root cause — kills DNS rebinding + cross-origin reach in one helper |
| 2 | [done/02-CRITICAL-api-settings-leaks-bearer-token.md](done/02-CRITICAL-api-settings-leaks-bearer-token.md) | CRITICAL | Token moved out of anonymous `GET /api/settings` |
| 3 | [done/03-CRITICAL-mutating-api-routes-are-anonymous.md](done/03-CRITICAL-mutating-api-routes-are-anonymous.md) | CRITICAL | Bearer required by default on `/api/*` routes |
| 4 | [done/04-CRITICAL-ipc-no-sender-attestation.md](done/04-CRITICAL-ipc-no-sender-attestation.md) | CRITICAL | `safeHandle` wrapper around every `ipcMain.handle` |
| 5 | [done/05-CRITICAL-pty-spawn-arbitrary-command-execution.md](done/05-CRITICAL-pty-spawn-arbitrary-command-execution.md) | CRITICAL | Allow-list binaries; confine `cwd`; skip shell parsing for agent spawns |
| 6 | [done/06-CRITICAL-files-write-can-plant-agent-hooks.md](done/06-CRITICAL-files-write-can-plant-agent-hooks.md) | CRITICAL | Generic writes block protected auto-exec paths |
| 7 | [done/07-HIGH-install-agent-hooks-cwd-not-validated.md](done/07-HIGH-install-agent-hooks-cwd-not-validated.md) | HIGH | Subsumed by bug 05's project-root `cwd` validation |
| 8 | [done/08-HIGH-bearer-token-non-constant-time-compare.md](done/08-HIGH-bearer-token-non-constant-time-compare.md) | HIGH | Uses `crypto.timingSafeEqual` |
| 9 | [done/09-CRITICAL-skills-install-writes-anywhere.md](done/09-CRITICAL-skills-install-writes-anywhere.md) | CRITICAL | Skills install is confined to registered project roots |
| 10 | [done/10-CRITICAL-launch-kit-writes-anywhere.md](done/10-CRITICAL-launch-kit-writes-anywhere.md) | CRITICAL | Launch Kit writes require a recent OS-folder-picker grant and reject sensitive parents |

## Two root causes drive most of this

- **HTTP root cause:** the local API server had no Origin/Host check, the bearer token was anonymously readable, and the rest of the API was not gated.
- **IPC root cause:** the renderer was implicitly trusted with no `event.senderFrame` check, multiplying PTY, file-write, and shell-open risks.

The remaining LOW items are defense-in-depth regression guards. The MEDIUM/HIGH follow-ups surfaced while fixing earlier CRITICAL items, so they are ordered by current blast radius rather than discovery order.
