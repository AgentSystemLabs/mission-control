# [CRITICAL] Electron IPC handlers don't validate the sender frame

**Files:** `electron/main.ts`, `electron/file-handlers.ts`, `electron/pty-manager.ts`, `electron/agent-hooks.ts`
**Category:** Trust boundary / IPC sender attestation
**Severity:** Critical (as a class)

## What's wrong

Every `ipcMain.handle` in the project trusts whatever sent the message. There are zero checks of `event.senderFrame.url` / `event.senderFrame === event.senderFrame.top` / origin allow-list across:

- `IPC.ptySpawn`, `IPC.ptyWrite`, `IPC.ptyKill`, `IPC.ptyKillLaunchProcesses` (`electron/pty-manager.ts`)
- `IPC.filesRead`, `IPC.filesWrite`, `IPC.filesList` (`electron/file-handlers.ts`)
- `IPC.shellOpenPath`, `IPC.shellOpenExternal` (`electron/main.ts:289-298`)
- `IPC.installSkillsRun`, `IPC.installSkillsFetchLatest` (`electron/main.ts:335-368`)
- `IPC.cliCheck`, `IPC.fileSaveProjectImage`, `IPC.appGetUserName`, etc.

`contextIsolation: true` and `nodeIntegration: false` are set (`electron/main.ts:142-147`) and `will-navigate` is intercepted (`electron/main.ts:179-181`) — those raise the bar, but they don't replace sender attestation.

## Why fixing this is important — what could go wrong

The IPC layer is the highest-blast-radius authority in the app. Any future event that gets attacker JS running in the renderer (even briefly) — an XSS in markdown rendering, a malicious AI-agent output that gets rendered as HTML, an iframe / `<webview>` added later, a dev-server compromise — gains the full IPC surface.

Concrete chained impact with the handlers above:

- `pty:spawn` → arbitrary RCE as the user (see finding 05)
- `files:write` → plant `.claude/settings.local.json` hooks that run on next agent invocation (see finding 06)
- `files:write` with `projectRoot: "/Users/victim"`, `relPath: ".zshrc"` → rewrite the user's shell init file (`resolveInsideRoot` permits it because no `..` is used)
- `shell:openPath` → execute any local `.app`/`.exe`/`.sh` (see finding 09)

Adding sender attestation now means the next time *any* of those preconditions is briefly true, the attack still fails.

## How to fix it

1. Define a single helper in `electron/ipc-channels.ts` (or next to it) that wraps every `ipcMain.handle`:

```ts
function safeHandle<T>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: any[]) => T) {
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.senderFrame.top) throw new Error("ipc: subframe not allowed");
    const url = frame.url;
    const ok =
      url.startsWith(`http://127.0.0.1:${runtimePort}`) ||
      url.startsWith(`http://localhost:${runtimePort}`) ||
      (isDev && url.startsWith("http://127.0.0.1:5173"));
    if (!ok) throw new Error(`ipc: rejected sender origin ${url}`);
    return fn(event, ...args);
  });
}
```

2. Replace every `ipcMain.handle(IPC.x, ...)` call with `safeHandle(IPC.x, ...)`.
3. Pass `runtimePort` into the IPC wiring at startup (it's already known to `startProductionServer`).
4. Add a Vitest covering the wrapper: a fake frame URL outside the allow-list throws; the dev URL is accepted only when `isDev`.
