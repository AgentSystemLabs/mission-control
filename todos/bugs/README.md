# Security audit findings

Generated 2026-05-16 from a full-codebase security pass (Electron main + IPC, local HTTP server, services).

Each `.md` in this directory is one HIGH or CRITICAL finding with the affected files, what could go wrong, and how to fix it.

## Fix order (highest leverage first)

| # | File | Severity | Notes |
|---|---|---|---|
| 1 | [01-http-api-missing-origin-host-check.md](01-http-api-missing-origin-host-check.md) | CRITICAL | Root cause — kills DNS rebinding + cross-origin reach in one helper |
| 2 | [02-api-settings-leaks-bearer-token.md](02-api-settings-leaks-bearer-token.md) | CRITICAL | Token is anonymously readable; the "protected" routes aren't |
| 3 | [03-mutating-api-routes-are-anonymous.md](03-mutating-api-routes-are-anonymous.md) | CRITICAL | Invert the allow-list: require auth on every mutating route |
| 4 | [04-ipc-no-sender-attestation.md](04-ipc-no-sender-attestation.md) | CRITICAL | `safeHandle` wrapper around every `ipcMain.handle` |
| 5 | [05-pty-spawn-arbitrary-command-execution.md](05-pty-spawn-arbitrary-command-execution.md) | CRITICAL | Allowlist binaries; confine `cwd`; skip `sh -c` |
| 6 | [06-files-write-can-plant-agent-hooks.md](06-files-write-can-plant-agent-hooks.md) | CRITICAL | Path/extension deny-list inside `filesWrite` |
| 7 | [07-skills-install-writes-anywhere.md](07-skills-install-writes-anywhere.md) | CRITICAL | Require auth; confine `projectPath` to known projects |
| 8 | [08-launch-kit-writes-anywhere.md](08-launch-kit-writes-anywhere.md) | CRITICAL | Require auth; confine `parentDir` to a small allow-list |
| 9 | [09-shell-openpath-arbitrary-execution.md](09-shell-openpath-arbitrary-execution.md) | HIGH | Extension deny-list + project-root confinement |
| 10 | [10-pty-mcenv-ssrf-and-token-exfil.md](10-pty-mcenv-ssrf-and-token-exfil.md) | HIGH | Drop renderer-supplied `mcEnv`; use main-process values |
| 11 | [11-install-agent-hooks-cwd-not-validated.md](11-install-agent-hooks-cwd-not-validated.md) | HIGH | Subsumed by finding 5's `cwd` validation |
| 12 | [12-missing-permission-request-handler.md](12-missing-permission-request-handler.md) | HIGH | `setPermissionRequestHandler(() => deny)` |
| 13 | [13-bearer-token-non-constant-time-compare.md](13-bearer-token-non-constant-time-compare.md) | HIGH | `crypto.timingSafeEqual` (cleanup, low priority once #2 lands) |

## Two root causes drive most of this

- **HTTP root cause** (findings 1–3, plus the network half of 7/8/10): the local API server has no Origin/Host check, anonymous routes leak the bearer token, and the rest aren't gated.
- **IPC root cause** (finding 4, multiplying 5/6/9/10/11): the renderer is implicitly trusted with no `event.senderFrame` check.

Fixing root cause 1 collapses the public-internet attack surface. Fixing root cause 2 raises the bar against any future renderer compromise (XSS in agent output, malicious project content, future iframe/webview).
