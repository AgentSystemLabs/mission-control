# Shift+Enter in the embedded terminal — investigation notes

## Symptom

Inside the embedded xterm.js terminal (running Claude Code), Shift+Enter is supposed to insert a literal newline into Claude Code's prompt. Observed behavior:

1. Press Shift+Enter on an empty prompt → newline inserted ✓
2. Type some characters
3. Press Shift+Enter again → input is **submitted** instead of a newline being inserted ✗

The user does not want to require running `claude /terminal-setup` for this to work — it should work out of the box for anyone using the app.

## Moving parts

| Layer | File | Role |
|---|---|---|
| Keymap (renderer) | `src/lib/terminal-keymap.ts` | Translates `Shift+Enter` → bytes `\x1b\r` (ESC + CR, the iTerm2 convention) |
| Terminal panes | `src/components/views/TerminalPane.tsx`, `UserTerminalPane.tsx` | Wire `attachCustomKeyEventHandler` on the xterm.js `Terminal`; on Shift+Enter, write the mapped bytes to the PTY |
| Preload IPC | `electron/preload.ts` | Exposes `electron.pty.write(ptyId, data)` |
| PTY backend | `electron/pty-manager.ts` | Spawns `node-pty`; `sanitizeEnv()` strips `TERM_PROGRAM`/`TERM_PROGRAM_VERSION` so Claude Code doesn't take terminal-specific code paths; `ensureClaudeShiftEnterBinding()` writes `shiftEnterKeyBindingInstalled: true` into `~/.claude/settings.json` (the same flag `claude /terminal-setup` writes) so Claude Code accepts `\x1b\r` as newline-in-input |
| TUI app | Claude Code (running inside the PTY) | Reads bytes from stdin; with the binding flag set, treats `\x1b\r` as "insert newline", treats lone `\r` or `\n` as "submit" |

End-to-end happy path: user presses Shift+Enter → renderer writes `\x1b\r` to PTY → Claude Code reads `\x1b\r` → newline is inserted in the prompt.

## What was already correct (pre-session)

- Keymap correctly returns `\x1b\r` for Shift+Enter (`terminal-keymap.ts:8-10`).
- `sanitizeEnv()` correctly strips `TERM_PROGRAM` to keep Claude Code on the iTerm-style code path that matches what xterm.js emits.
- `ensureClaudeShiftEnterBinding()` writes the global flag.

## Bug #1 — fixed earlier in this session

`ensureClaudeShiftEnterBinding()` was being called only inside the `if (opts.agent === "claude-code")` branch of the `pty:spawn` handler. That meant the global flag was only written when a Mission Control task spawned a Claude Code agent. If the user opened the user terminal (no `agent` field) and typed `claude` themselves, the flag was never written → Claude Code didn't recognize `\x1b\r` as newline.

**Fix:** hoisted `ensureClaudeShiftEnterBinding()` out of the agent-conditional block and into `registerPtyHandlers()` so it runs once at app boot regardless of which terminal surface is opened. `installClaudeHooks(opts.cwd)` correctly remained per-spawn (it's per-project).

`electron/pty-manager.ts:142-143` and `:166-168`.

## Bug #2 — current hypothesis (fix pushed, awaiting verification)

After applying Fix #1, the user still saw the "first Shift+Enter works, second submits" pattern.

### Hypothesis

xterm.js renders the visible terminal canvas, but **input is captured by a hidden `<textarea>`** that holds focus. xterm.js's keydown listener on that textarea calls our `customKeyEventHandler` first; if it returns `false`, xterm.js bails out *before* calling `event.preventDefault()`. The browser's default action for Shift+Enter on a `<textarea>` is **to insert a `\n` into the textarea's value**. xterm.js's separate `input`-event listener then sees the new content and forwards `\n` to the PTY as a second write.

Net result on the wire: the PTY receives `\x1b\r` (from our handler) **followed by** `\n` (from the textarea leak).

Claude Code parses:
- `\x1b\r` → "insert newline" (Alt+Enter / iTerm shift+enter) ✓
- `\n` → another keypress, treated as Enter → submit

### Why "first works, then breaks"

- **First Shift+Enter on empty input**: `\x1b\r` inserts the newline → prompt is now `\n`. The trailing `\n` triggers a submit on a prompt that's effectively just-a-newline → no-op or near-no-op, so the user perceives the newline as having been inserted successfully.
- **Type "hello"** → prompt is `\nhello`.
- **Second Shift+Enter**: `\x1b\r` inserts another newline → `\nhello\n`. The trailing `\n` then submits `\nhello\n`. From the user's perspective, "Shift+Enter just submitted my input."

This matches the reported failure shape exactly.

### Fix attempted

Added `e.preventDefault()` before writing the mapped bytes to the PTY, in both `attachCustomKeyEventHandler` callsites:

```ts
term.attachCustomKeyEventHandler((e) => {
  const bytes = mapTerminalKey(e);
  if (bytes === null) return true;
  e.preventDefault(); // stop xterm.js's hidden textarea from also inserting \n
  if (activePtyId) electron.pty.write(activePtyId, bytes);
  return false;
});
```

Files:
- `src/components/views/TerminalPane.tsx` (~line 144)
- `src/components/views/UserTerminalPane.tsx` (~line 112)

The change is renderer-only — reload the renderer (no main-process restart needed) to pick it up.

## How to verify

1. Reload the renderer (or restart the app).
2. Open a Claude Code terminal in Mission Control.
3. Press Shift+Enter on an empty prompt → newline.
4. Type `hello`.
5. Press Shift+Enter → newline (no submit).
6. Type `world`.
7. Press Shift+Enter → newline.
8. Press Enter → submits `\nhello\nworld\n`.

If step 5 still submits, the hypothesis is wrong or incomplete. Next things to check:

- Is the PTY actually receiving two writes? Add a temporary log in `pty-manager.ts`'s `pty:write` handler (`console.log("pty:write", JSON.stringify(data))`) and watch the dev-tools / terminal output. If you see two writes (`"\r"` then `"\n"`) per Shift+Enter, the leak is still happening.
- Is `~/.claude/settings.json` actually set to `shiftEnterKeyBindingInstalled: true`? `cat ~/.claude/settings.json`.
- Is `TERM_PROGRAM` actually absent in the PTY's env? `env | grep TERM` inside the PTY shell.
- Does xterm.js v6 even use a hidden textarea by default? (It does in the DOM renderer; the canvas/WebGL renderers also forward to a textarea for input.) Confirm by inspecting the xterm container's DOM and looking for `<textarea class="xterm-helper-textarea">`.

## Why not switch terminals (Ghostty, etc.)

Briefly considered. Ghostty / WezTerm / Alacritty are native apps (Zig / Rust) that render via Metal/OpenGL and aren't designed as embeddable widgets — there's no "Ghostty React component." xterm.js + node-pty remains the standard Electron stack (VS Code, Hyper, Warp's older versions). The right answer is to make xterm.js emit the right bytes, which is what these notes are about.

## Open follow-ups

- The two `attachCustomKeyEventHandler` blocks in `TerminalPane.tsx` and `UserTerminalPane.tsx` are now identical. If a third terminal surface ever appears, extract a `wireTerminalKeymap(term, getActivePtyId)` helper. Two instances doesn't justify the abstraction yet.
- Consider whether `e.stopPropagation()` is also needed. Probably not — the textarea is inside xterm's container and there are no outer keydown listeners that matter — but if some global hotkey fires on Shift+Enter in the embedded terminal, that's where to look.
