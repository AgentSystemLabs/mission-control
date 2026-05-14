---
name: add-observability
user-invocable: false
metadata:
  audience: handoff
description: Internal handoff target invoked by add-feature and modify-feature when wiring integration boundaries (HTTP/webhook dispatch, IPC, Claude Code hooks, queues, file writes, env-var injection, MCP tool calls, spawned processes) so that when a side effect later goes silent, fix-bug reads literal evidence instead of guessing. Instruments boundaries with leveled, structured logs and typed error reporting. Detects the project's existing logger and conforms; if none exists, proposes a minimal leveled logger or a zero-dep `console`-based fallback. Replaces silent-failure patterns (`|| true`, empty `catch {}`, `>/dev/null 2>&1`) with logged catches that preserve behavior. Trigger phrases for routing: "instrument this", "add logging to X", "this integration has no logs", "make this debuggable", "proactive logging", "structured logs for this feature", "wire up observability", "I want a trail for this". Skip for pure unit-test code, internal utility functions with no I/O, generated code, third-party vendor files, and reactive debugging of a specific failure (use fix-bug instead).
---

# Code Add Observability

Add evidence to integration boundaries *before* something goes silent. The output of this skill is read by `/fix-bug` later — its first message reports endpoints, env vars, and **log/observation locations**. If the locations don't exist, `/fix-bug` is reduced to hypothesis-testing.

A "boundary" is any place control or data leaves the local module: outbound HTTP, IPC send/receive, queue enqueue/handler, file write, env-var injection into a child process, hook invocation, webhook receiver, MCP tool entry, `spawn`/`exec`. Pure functions are not boundaries. Logs at non-boundaries are noise.

---

## Phase 1 — Scope

Determine mode:

- **Targeted** — user named a feature, file, route, or integration. Scope = that surface plus its direct dispatch/receive sites.
- **Sweep** — invoked after a feature ships (often after `/add-feature`). Scope = `git diff <base>..HEAD` filtered to source files.

If mode is ambiguous, ask once: *"Targeted (which file/feature?) or sweep over the current branch's diff?"* Do not guess.

**Exit condition:** you can list the file paths in scope as a bulleted list before moving on.

---

## Phase 2 — Logger discovery

Detect first; install last. Check in this order, stop at the first hit:

1. **Imported logger** — grep scoped files and shared `lib/`/`src/utils/` for `from ['"]pino`, `from ['"]winston`, `from ['"]electron-log`, `import debug from ['"]debug`, `from ['"]bunyan`, `from ['"]@logtape`, `loglevel`.
2. **Project-local wrapper** — `logger.ts`, `log.ts`, `lib/logger.*`, `src/log/*`. If found, read its API and conform.
3. **Package manifest** — `package.json` `dependencies`/`devDependencies` for any of the above.
4. **None found** — load [`references/logger-bootstrap.md`](references/logger-bootstrap.md) and follow its decision tree (zero-dep fallback vs. propose installing `pino`).

**Before installing anything, ask the user.** Frame as: *"No logger detected. Options: (a) zero-dep `console`-based logger with `LOG_LEVEL` env gate (no install), (b) install `pino` (tiny, fast, structured), (c) point me at a logger I missed."*

**Exit condition:** you have a single `log.{debug,info,warn,error}` API to call, and you know its import path. Write that import path down — every recipe in Phase 4 reuses it.

---

## Phase 3 — Boundary enumeration

**Thinking frame:** a boundary is any place control or data leaves this module's process or address space — outbound network, IPC, spawned process, file system, queue broker, hook handoff. If a future call site fits that test but isn't in the list below, treat it as a boundary anyway.

For each in-scope file, list every boundary call site as `path:line — <type>`. Boundary types:

- **outbound-http** — `fetch`, `axios`, `got`, `undici.request`, route-internal `$fetch`
- **inbound-http** — route handlers, webhook receivers, server-fn entrypoints
- **ipc-send / ipc-recv** — Electron `ipcMain.handle`, `ipcRenderer.invoke`, `webContents.send`
- **spawn** — `spawn`, `exec`, `execFile`, `fork`, `pty.spawn`
- **env-injection** — places that build a `env: {…}` object passed to a spawn
- **file-write** — `fs.writeFile`, `fs.appendFile`, settings/config writers
- **queue** — `enqueue(`, `.add(`, `.publish(`, worker `process(`/`consume(`
- **hook** — Claude Code hook scripts, framework lifecycle hooks invoked by external systems
- **mcp** — MCP server tool handlers
- **silent-failure** — `|| true`, empty `catch {}`, `>/dev/null 2>&1`, `.catch(() => {})` on the dispatch path

Show this list to the user and confirm before instrumenting. **Exit condition:** confirmed list. If >20 boundaries, group by file and ask which to prioritize — do not bulk-edit a sprawling list without acknowledgment.

---

## Phase 4 — Instrument

**MANDATORY READ — [`references/boundary-recipes.md`](references/boundary-recipes.md)** before editing. It maps each boundary type to a precise instrumentation recipe (event name, fields, level, where the catch goes). Do NOT load it during Phase 1–3.

Apply recipes one boundary at a time. After each file, run type-check (`tsc --noEmit` or project equivalent) before moving to the next. Do not bulk-edit then verify at the end — a typo in the logger import propagates silently.

**If type-check fails:** revert that file's edits, re-read the failing import (logger path, type of `err` in catch, payload field shape), and reapply with a smaller diff — one boundary, not the whole file. Do not proceed to the next file with red type errors; cascading errors mask the real cause.

**Silent-failure handling** (the most error-prone case):

| Pattern | Replacement |
|---|---|
| `await foo() \|\| true` (in shell) | `await foo() \|\| { log.error({event:"foo.failed", err:$?}); true; }` — preserves swallow, adds evidence |
| `catch {}` | `catch (err) { log.error({event:"<site>.failed", err}); }` — never silently delete; the swallow may be load-bearing |
| `.catch(() => {})` | `.catch((err) => log.error({event:"<site>.failed", err}))` |
| `>/dev/null 2>&1` | `>>"$LOG_FILE" 2>&1` with `LOG_FILE` resolved from a known location, OR keep redirect and add a pre-call `log.info` |

**Never delete a swallow.** Callers may depend on the failure being non-fatal. Add evidence; preserve behavior.

**Exit condition:** every confirmed boundary has a log call (or a logged-catch wrapper). Type-check is green.

---

## Phase 5 — Trail discoverability

`/fix-bug`'s first message lists **log/observation locations**. Make that lookup possible:

1. **Stable event names** — every boundary's log uses a `event: "<domain>.<verb>"` field (e.g. `auth.login.dispatched`, `webhook.stripe.received`). Greppable.
2. **Where logs land** — confirm: stdout? a file? OS log? Document it in one place. If there isn't one, add a one-line comment near the logger import: `// Logs: stdout (dev) | <path> (prod via LOG_FILE env)`.
3. **Index** — append a section to `README.md` (or create `docs/observability.md` only if README has no logical home) listing the event-name prefixes used and their locations. One bullet per prefix, file:line of the dispatch site. This is what `/fix-bug` greps.

**Exit condition:** `rg 'event:\s*"<prefix>\.' src/` returns the boundary sites for any prefix you instrumented.

---

## Phase 6 — Verify the trail fires

Pick one boundary you instrumented. Trigger it (run the route, send the IPC, write the file) and confirm the log line appears at the documented location with the expected event name and fields.

If it doesn't fire: the import is wrong, the level is gated out, or the boundary isn't actually on the runtime path. Fix before declaring done. **A skill that adds logs that never fire is worse than no logs** — it gives `/fix-bug` false confidence.

**If the boundary can't be triggered locally** (cron handler, queue worker requiring infra, webhook from a third party): pick the cheapest substitute that exercises the same code path — call the handler function directly from a one-shot script, or have the user run a single repro and paste the resulting log line. Do not declare done on a boundary you have not seen emit.

---

## NEVER

- **NEVER instrument non-boundaries** (pure functions, internal helpers, getters, render code paths)
  **Instead:** Restrict to the boundary taxonomy in Phase 3.
  **Why:** Log soup hides the real signal. `/fix-bug` greps for boundary events; internal-function logs dilute the result and train users to ignore the trail.

- **NEVER silently delete a `catch {}` or `|| true` swallow**
  **Instead:** Replace with a logged catch that preserves the original control flow (re-throw only if the original `catch` re-threw).
  **Why:** Swallows are sometimes load-bearing — the caller depends on the operation being best-effort. Deleting one turns a quiet bug into a loud crash in production. Add evidence; preserve behavior.

- **NEVER install a logger dependency without asking**
  **Instead:** Offer the zero-dep fallback first; install only on explicit user approval.
  **Why:** New dependencies have license, supply-chain, and bundle-size implications the agent can't assess. The zero-dep fallback is sufficient for 80% of projects.

- **NEVER use `console.log` for instrumentation when a leveled logger exists**
  **Instead:** Use the detected logger's `info`/`debug` level. Reserve `console.log` for the zero-dep fallback's structured wrapper.
  **Why:** `console.log` can't be filtered, can't be redirected per-environment, and gets mixed with framework noise. The whole point is a *greppable, filterable* trail.

- **NEVER instrument and then skip Phase 6 (fire-the-trail verification)**
  **Instead:** Trigger at least one boundary and confirm the log appears at the documented location.
  **Why:** Wrong import path, gated log level, or a boundary off the runtime path produces zero output — `/fix-bug` will later read "no logs" and assume the integration didn't run, sending the user down a dead end.

- **NEVER let event names drift across shapes**
  **Instead:** Use `<domain>.<verb>` lowercase-dot-separated, with verbs from a fixed verb set (`dispatched`, `received`, `failed`, `completed`, `skipped`, `swallowed`). ❌ `auth_login`, `loginEvent`, `auth.LoginAttempted`. ✅ `auth.login.dispatched`, `auth.login.failed`. Conform any pre-existing logs you touch in this pass.
  **Why:** `/fix-bug`'s first move is `rg 'event:'`. Inconsistent shapes mean it greps three times and still misses the fourth pattern — the trail exists but is invisible.

- **NEVER overlap with `/fix-bug`** (this skill is proactive; `/fix-bug` is reactive)
  **Instead:** If the user is reporting a current silent failure, hand off to `/fix-bug` — instrument only after the immediate bug is found, as part of the fix.
  **Why:** Instrumenting under time pressure produces hasty event names and missed boundaries. The two skills compose: `/fix-bug` finds the bug, this skill prevents the next one.

---

## Trigger question before declaring done

**"If `/fix-bug` opens on any of the boundaries I instrumented tomorrow, will its first message be able to fill in: endpoint, env vars, on-disk artifacts, log/observation locations, and the exact event name to grep for?"** If not, return to Phase 5.
