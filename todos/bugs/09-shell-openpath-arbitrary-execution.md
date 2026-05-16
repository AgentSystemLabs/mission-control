# [HIGH] `shell:openPath` IPC executes any local file the renderer names

**Files:** `electron/main.ts:289-294`
**Category:** Arbitrary local-file execution
**Severity:** High

## What's wrong

The `shell:openPath` handler calls `shell.openPath(p)` with an arbitrary string from the renderer. `shell.openPath` launches the OS-default handler for that path. For these file types, that means **direct code execution**:

- macOS: `.app` bundles, `.command`, `.sh` with execute bits, `.pkg`, `.dmg`
- Windows: `.exe`, `.bat`, `.cmd`, `.com`, `.scr`, `.ps1`, `.msi`
- Linux: `.desktop` files, executables, `.sh`
- Cross-platform: Office docs with macro execution (`.docm`, `.xlsm`, …), `.jar`

There is no path validation, no extension check, and no requirement that the path was previously issued by an OS dialog. Compare `IPC.fileSaveProjectImage` (`electron/main.ts:247-278`), which gates on `ALLOWED_PICKED_PATHS` — `openPath` has nothing equivalent.

## Why fixing this is important — what could go wrong

Two delivery paths:

1. **Compromised renderer (finding 04):** call `window.electronAPI.openPath("/path/to/installer.app")`. The binary launches with no Gatekeeper re-prompt for paths the user has already trusted (e.g. inside their Downloads folder or any user-owned location).
2. **Legitimate UI tricked by attacker file names:** a project the user opens contains `tools/installer.app` or `setup.exe`; a context-menu "Open" wired through `openPath` will run it.

The macOS `.app` case is particularly bad because `shell.openPath` bypasses some of the prompt the Finder shows for newly-downloaded apps.

## How to fix it

1. In `electron/main.ts:289-294`, before calling `shell.openPath`, enforce:
   - The resolved path is inside a registered project root (look up `projects.path` from the DB).
   - The extension is **not** on a deny-list:
     ```
     .app .exe .bat .cmd .com .scr .ps1 .sh .command
     .desktop .jar .pkg .msi .dmg
     .docm .xlsm .pptm .dotm .xltm .potm
     ```
2. For executable opens the user genuinely wants (e.g. "reveal in finder" → that's a different API: `shell.showItemInFolder`, not `openPath`), use the right Electron API in the renderer.
3. Combine with finding 04's `safeHandle` wrapper.
