# Terminal Close → Focus Bug

## Symptom

In an Electron app (Mission Control), the user opens **3 split-pane terminals** in the bottom panel. They click into terminal #3 (the last/rightmost) so it has focus and shows the accent outline. They close terminal #3 (either by clicking the `<X>` button in the pane header, or by pressing **Cmd+W** which is forwarded from the Electron main menu).

**Expected:** Pane #2 (the new last pane) takes focus — it gets the accent outline and the xterm hidden textarea is focused so the user can immediately type.

**Actual:** Terminal #3 closes correctly (PTY killed, row removed, pane unmounts). But neither pane #1 nor pane #2 ends up focused. The accent outline disappears entirely. The user has to manually click on a terminal pane to put focus back on its xterm.

This bug only happens when closing the **focused** terminal. Closing a non-focused terminal (e.g., focused on #2, click X on #3) works fine — focusedId is unchanged because the killed terminal wasn't focused.

## Repro

1. `npm run dev` (Vite + Electron).
2. Open or create a project. Open the project terminals panel (Ctrl+`).
3. Click "+ New" three times to get 3 split panes side-by-side.
4. Click into the leftmost pane #1, then #2, then #3 — pane #3 has the accent outline now.
5. Click the `<X>` button on pane #3 (or press Cmd+W).
6. Observe: outline disappears entirely, no pane has focus, typing does nothing until you click into a pane.

## App architecture (relevant parts)

This is a TanStack Start + Electron app. Terminal sessions are held in a React context provider. xterm.js renders the terminal in each pane.

### Provider tree

```
KeybindingsProvider
  └─ TerminalProvider           (legacy "agent task" terminals — not involved here)
      └─ UserTerminalProvider   (user-created split-pane terminals — this is the bug)
          └─ Shell
              └─ <Outlet />     (route content)
              └─ UserTerminalPanel
                  └─ UserTerminalPane × N (one per session)
```

### Key state shapes

`UserTerminalProvider` holds:

```ts
const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
const [focusedByProject, setFocusedByProject]   = useState<Record<string, string | null>>({});
```

Sessions are keyed by project id so PTYs survive project switches. Each render derives:

```ts
const sessions  = project ? (sessionsByProject[project.id] ?? []) : [];
const focusedId = project ? (focusedByProject[project.id] ?? null) : null;
```

### How a pane is rendered

`UserTerminalPanel` maps sessions → `<UserTerminalPane>`, passing `focused={focusedId === s.terminal.id}`:

```tsx
sessions.map((s, i) => (
  <UserTerminalPane
    key={s.terminal.id}
    terminal={s.terminal}
    ptyId={s.ptyId}
    focused={focusedId === s.terminal.id}
    onFocus={() => focusTerminal(s.terminal.id)}
    onKill={() => void killTerminal(s.terminal.id)}
    ...
  />
))
```

The pane wraps an xterm instance. Two relevant effects:

```tsx
// 1) Initialize xterm once per terminal id. Stores a focus handle in termRef.
useEffect(() => {
  // ... async load of @xterm/xterm and @xterm/addon-fit ...
  const term = new Terminal({...});
  term.open(containerRef.current);
  termRef.current = { focus: () => term.focus() };
  term.focus();

  const onFocusIn = () => onFocus(); // bubbles up so click anywhere inside marks pane as focused
  focusEl.addEventListener("focusin", onFocusIn);
  // ...
}, [terminal.id]);

// 2) When the `focused` prop becomes true (after cycling or sibling-close),
//    pull DOM focus to the xterm. Currently wrapped in rAF as a fix attempt.
useEffect(() => {
  if (!focused) return;
  const raf = requestAnimationFrame(() => termRef.current?.focus());
  return () => cancelAnimationFrame(raf);
}, [focused]);
```

The wrapper div carries the visual outline and a `onMouseDown={onFocus}` handler:

```tsx
<div
  onMouseDown={onFocus}
  style={{ outline: focused ? "1px solid var(--accent)" : "none", ... }}
>
  <div className="header">
    <span>{terminal.name}</span>
    <button onClick={onKill}><Icon name="x" /></button>  {/* this kills the terminal */}
  </div>
  <div ref={containerRef} />  {/* xterm mounts here */}
</div>
```

### killTerminal (CURRENT, post-attempted-fix)

```ts
const killTerminal = useCallback(
  async (id: string) => {
    const electron = getElectron();
    // Resolve owner + neighbor synchronously from the latest snapshot.
    const snapshot = sessionsByProjectRef.current;
    let ownerProjectId: string | null = null;
    let killedPtyId: string | null = null;
    let neighborId: string | null = null;
    for (const [pid, list] of Object.entries(snapshot)) {
      const idx = list.findIndex((s) => s.terminal.id === id);
      if (idx === -1) continue;
      ownerProjectId = pid;
      killedPtyId = list[idx]!.ptyId;
      const filtered = list.filter((s) => s.terminal.id !== id);
      if (filtered.length > 0) {
        const pick = idx > 0 ? idx - 1 : 0;
        neighborId = filtered[pick]!.terminal.id;
      }
      break;
    }
    if (!ownerProjectId) return;

    setSessionsByProject((prev) => ({
      ...prev,
      [ownerProjectId!]: (prev[ownerProjectId!] ?? []).filter(
        (s) => s.terminal.id !== id
      ),
    }));
    setFocusedByProject((prev) => {
      if (prev[ownerProjectId!] !== id) return prev;
      return { ...prev, [ownerProjectId!]: neighborId };
    });

    if (killedPtyId && electron) {
      await electron.pty.kill(killedPtyId).catch(() => undefined);
    }
    try {
      await api.deleteUserTerminal(id);
    } catch { /* swallow */ }
  },
  []
);
```

`sessionsByProjectRef` is kept in sync via:

```ts
const sessionsByProjectRef = useRef<Record<string, Session[]>>({});
useEffect(() => {
  sessionsByProjectRef.current = sessionsByProject;
}, [sessionsByProject]);
```

### Cmd+W path (Electron main → renderer)

`__root.tsx`:

```ts
useEffect(() => {
  const electron = getElectron();
  if (!electron) return;
  return electron.onCloseIntent(() => {
    if (userTerminals.panelOpen && userTerminals.focusedId) {
      void userTerminals.killTerminal(userTerminals.focusedId);
    }
  });
}, [userTerminals]);
```

The Electron main process intercepts Cmd+W, forwards `app:close-intent`. The renderer calls the same `killTerminal` as the X-button path. So both paths share the bug.

## What I've tried

### Attempt 1: Wrap `term.focus()` in requestAnimationFrame

**Hypothesis:** On Chromium/Electron, calling `term.focus()` synchronously in the focus useEffect doesn't stick because the previously-focused element (the X button on the unmounting pane) is being torn down in the same frame. Deferring to the next frame should let focus settle.

**Change made:**

```ts
// Before
useEffect(() => {
  if (focused) termRef.current?.focus();
}, [focused]);

// After
useEffect(() => {
  if (!focused) return;
  const raf = requestAnimationFrame(() => termRef.current?.focus());
  return () => cancelAnimationFrame(raf);
}, [focused]);
```

**Result:** No effect. User reports the bug is identical.

**Why this could still be wrong:** This effect only fires when `focused` flips false→true on a surviving pane. If `focusedId` ends up `null` (or pointing at the killed terminal), no surviving pane ever gets `focused=true`, so the effect never runs at all. (See attempt 2.)

### Attempt 2: Refactor `killTerminal` away from closure-mutation in setState updaters

**Hypothesis:** The original `killTerminal` mutated outer-scope variables (`ownerProjectId`, `killedPtyId`, `neighborId`) inside a `setSessionsByProject((prev) => {...})` updater, then read them on the next lines. Specifically:

```ts
// Original buggy version
let ownerProjectId: string | null = null;
let killedPtyId: string | null = null;
let neighborId: string | null = null;
setSessionsByProject((prev) => {
  for (const [pid, list] of Object.entries(prev)) {
    const idx = list.findIndex((s) => s.terminal.id === id);
    if (idx === -1) continue;
    ownerProjectId = pid;          // <-- side effect
    killedPtyId = list[idx]!.ptyId;
    // ...
    neighborId = filtered[pick]!.terminal.id;
    next[pid] = filtered;
    break;
  }
  return next;
});
if (killedPtyId && electron) { await electron.pty.kill(killedPtyId); }
if (ownerProjectId) {
  setFocusedByProject((prev) => ({ ...prev, [ownerProjectId!]: neighborId }));
}
```

In React 18, `dispatchSetState` only computes the next state eagerly (which calls the updater synchronously) when `fiber.lanes === NoLanes`. If the same fiber already has pending lanes (e.g., from a *previous* setState in the same event handler — which is exactly our case because the pane wrapper's `onMouseDown={onFocus}` fires `setFocusedByProject` BEFORE the X button's `onClick` fires `killTerminal`), eager evaluation is **skipped** and the updater runs lazily during the next render.

That would mean `ownerProjectId`, `killedPtyId`, `neighborId` are still `null` when the `if (ownerProjectId) setFocusedByProject(...)` line executes, so `setFocusedByProject` is never called. `focusedId` stays pointing at the dead terminal id, no surviving pane has `focused=true`, no outline.

**Change made:** Read sessionsByProject from a ref synchronously, compute the values in plain code, then dispatch state updates with already-resolved values. (See "killTerminal (CURRENT)" above.)

**Result:** Still no fix. User reports the bug is identical.

### Attempt 3 (NOT TRIED): instrument with console.log

I suggested adding logs to verify whether `focused` actually flips to true on a surviving pane and whether `term.focus()` runs but the textarea doesn't get focus. I haven't actually run this — would be the next diagnostic step.

## Open hypotheses

1. **`focusedId` is being set correctly but `term.focus()` doesn't grab focus.**
   The xterm hidden textarea is theoretically inside `containerRef.current`. After unmount of pane #3, the document active element is `body`. `term.focus()` should focus the textarea — but maybe it doesn't if the xterm instance was created when the pane wasn't initially focused, or if there's a tabindex issue.

2. **A different code path is wiping focus AFTER the focus effect runs.**
   E.g., the `onFocusIn` listener on each pane fires when its xterm gains focus, calling `onFocus()` which sets focusedId. If pane #2 gains focus and triggers `setFocusedByProject` to the same value, that re-render is a no-op for `focused`. But what if some ancestor stole focus?

3. **`termRef.current` is null when the rAF fires on the surviving pane.**
   Possible if there's a remount cycle. But `key={s.terminal.id}` is stable for surviving panes, so React should not unmount them. Worth verifying.

4. **The `setFocusedByProject` updater short-circuits.**
   The current updater does:
   ```ts
   if (prev[ownerProjectId!] !== id) return prev;
   ```
   This check means: only update focused if the killed terminal was the focused one. But there's a subtle race: if the wrapper's `onMouseDown={onFocus}` fired BEFORE the X click set focused to `#3`, this check passes. If for any reason the focused id was already set to something else (e.g., #2 from some prior interaction), the updater would bail and focus would stay on the now-dead terminal. But we expect the test scenario to have focused=#3 right before close.

5. **There's an even earlier setState for focus that's putting focusedId in an unexpected state.**
   Worth dumping `focusedByProject` before/after each interaction.

## Files involved

- `src/lib/user-terminal-store.tsx` — the provider with the bug-prone code
- `src/components/views/UserTerminalPane.tsx` — pane component, owns xterm instance
- `src/components/views/UserTerminalPanel.tsx` — renders the panes, passes focused/onFocus/onKill props
- `src/routes/__root.tsx` — wires Cmd+W → killTerminal

## Environment

- Electron renderer: Chromium-based
- React 18, no `<StrictMode>` wrapper (verified — root only uses `createRootRouteWithContext`)
- No concurrent mode features explicitly opted into
- Vite dev server with HMR
- xterm.js v5

## What I'd try next

1. **Diagnostic logs** in `killTerminal`, the focus useEffect on `UserTerminalPane`, and the `onFocusIn` handler. Specifically:
   ```ts
   // killTerminal entry
   console.log("[kill] id=", id, "snapshot=", JSON.stringify(snapshot));
   console.log("[kill] resolved", { ownerProjectId, killedPtyId, neighborId });

   // focus effect
   useEffect(() => {
     console.log("[pane focus effect]", terminal.id, "focused=", focused, "termRef=", !!termRef.current);
     if (!focused) return;
     const raf = requestAnimationFrame(() => {
       console.log("[pane rAF]", terminal.id, "active=", document.activeElement?.tagName, "calling term.focus");
       termRef.current?.focus();
       queueMicrotask(() => console.log("[pane after]", terminal.id, "active=", document.activeElement?.tagName));
     });
     return () => cancelAnimationFrame(raf);
   }, [focused]);
   ```
   Reproduce the bug once. The logs will tell you:
   - Did `killTerminal` resolve a non-null `neighborId`? (If not, the ref isn't catching up — could be timing of the useEffect that mirrors `sessionsByProject` to the ref.)
   - Did the surviving pane's focus effect fire with `focused=true`? (If not, `focusedId` isn't reaching the right value — the bug is upstream.)
   - Did `term.focus()` actually move `document.activeElement` from BODY to a TEXTAREA? (If not, xterm's focus call is no-oping.)

2. **Imperative focus** instead of state-driven. Instead of relying on `focused` prop + useEffect, have `killTerminal` directly call a focus method on the surviving pane via a ref registry. Bypasses any state-update timing issues entirely.

3. **Move focus state into a useReducer** so the kill + focus update are one atomic dispatch, not two separate setState calls that can interleave with renders.

4. **Check `electron/main.ts` Cmd+W handler** — make sure it's not also closing the BrowserWindow or doing something that yanks focus away from the renderer process.

5. **Inspect with React DevTools** during repro to see the actual sequence of `focusedByProject` and `sessionsByProject` updates and confirm what the surviving pane's `focused` prop value is at each render.
