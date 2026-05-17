# [MEDIUM] `SpawnPolicyError` echoes attacker-controlled `cwd` / `agent` / `args` back to the renderer

**Files:** `electron/pty-spawn-policy.ts:116,134,175,190,202` (error message construction), `electron/pty-manager.ts:285-286` (rewrap)
**Category:** Log/error-message injection (low blast radius today, regression magnet)
**Severity:** Medium
**Surfaced by:** reviewer-security-regression on bug 05 fix (2026-05-16)

## What's wrong

When the bug-05 spawn policy rejects a request, the error message embeds the offending input verbatim:

```ts
// pty-spawn-policy.ts:116
`cwd is not an accessible directory: ${req.cwd}`
// pty-spawn-policy.ts:134
`cwd is not within any registered project root: ${req.cwd}`
// pty-spawn-policy.ts:175
`pty:spawn agent="${req.agent}" is not in the allow-list`
// pty-spawn-policy.ts:190
`pty:spawn agent="${agentKey}" must run "${expectedBinary}" (got "${tokens[0]}")`
// pty-spawn-policy.ts:202
`pty:spawn rejected shell metacharacter in arg: ${JSON.stringify(arg)}`
```

The IPC handler then rewraps:

```ts
// pty-manager.ts:285-286
throw new Error(`pty:spawn rejected (${err.code}): ${err.message}`);
```

…and the renderer surfaces it via `term.writeln(\`[failed to start pty: ${err?.message || err}]\`)` (TerminalPane.tsx:275).

Inputs reach the rendered string unfiltered — including ANSI escape sequences in `args`, long crafted strings in `command`, and Unicode bidirectional-override characters in `cwd`.

## Why fixing this is important — what could go wrong

Two scenarios, neither catastrophic but worth pre-empting:

1. **Terminal spoofing via ANSI escapes.** `term.writeln` is an xterm.js write, which honors CSI/SGR. A renderer-supplied `args: ["\x1b[2J\x1b[H[OK] command succeeded"]` survives `JSON.stringify` (which escapes `` to `` in JSON output — but Node's `JSON.stringify` actually leaves the escape literal in the output string). The resulting error toast can clear the terminal and paint fake output. Low blast radius — the user knows they tried to spawn — but a phishing primitive.

2. **Log-injection if errors ever go to a real terminal or to a shared log pipeline.** `electron-log/main` writes structured records to `~/Library/Logs/MissionControl/main.log`. A log viewer that doesn't sanitize ANSI rendering or that pipes through `cat` will execute the escapes. Bug 05's fix added a log line for every rejection (`log.warn("pty.spawn.rejected", {…})`), which includes the renderer-supplied `cwd` and `taskId` as structured fields — better than free-text but still worth confirming the eventual viewer doesn't render them.

3. **Echoing internal paths to a context where the user might paste them.** A user filing a bug report screenshots a "spawn failed" toast. If the path contains a username or a project name that's later considered sensitive, it leaks into the screenshot.

## How to fix it

Three light-touch options, pick one or combine:

1. **Strip control characters before interpolation.** `cwd.replace(/[\x00-\x1f\x7f]/g, "?")` and same for `args`/`command` echo sites. Cheap and complete for terminal-spoofing.
2. **Truncate to a fixed budget.** `JSON.stringify(arg).slice(0, 80)` in the meta-rejection message; same for `cwd` and `agent`. Bounds the worst case.
3. **Move attacker-controlled data out of the user-visible message entirely.** Have `pty:spawn rejected (${err.code})` be the renderer-facing message and put the offending input in the main-process log only. Loses some debuggability but cleanest.

Option 3 is the most defensive. Option 1 is the smallest diff.

## Notes

- The main-process log added in bug 05's fix (`log.warn("pty.spawn.rejected", {…})`) is structured, so a JSON-log viewer is safe. The risk is the user-facing renderer toast and any future text-mode log path.
- `JSON.stringify` does NOT escape `` ESC in default mode — the literal byte appears in output. Don't rely on it.
