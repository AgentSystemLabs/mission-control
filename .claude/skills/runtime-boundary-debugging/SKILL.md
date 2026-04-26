---
name: runtime-boundary-debugging
description: Debug cross-runtime failures by tracing which process actually loads the failing code. Use when errors involve Electron vs Node, browser vs server, dev server vs packaged app, worker vs main thread, CLI vs app runtime, native modules, API boundaries, or behavior that appears to fail in one layer but may originate in another.
---

# Runtime Boundary Debugging

Use this skill when a bug crosses process or runtime boundaries. The goal is to identify the runtime that owns the failing dependency or side effect before changing libraries, rebuild commands, or architecture.

## Triggers

Apply this workflow when the user reports:

- A UI action failing because of server, database, filesystem, native module, or CLI behavior.
- Errors mentioning runtime-specific loading, native bindings, module versions, bundled apps, workers, preload scripts, or dev servers.
- Confusion about whether code runs in the browser, server, Electron main process, renderer, worker, package runtime, or local CLI.
- A bug that reappears after restart, reinstall, rebuild, packaging, or switching between dev and production.

## Workflow

1. Name the failing action in user terms.
   Example: "Creating a project fails."

2. Trace the execution path from the user action to the failing operation.
   Include every boundary crossing: UI event, fetch/API call, IPC call, worker message, spawned process, database call, filesystem access, or native module load.

3. Identify each runtime involved.
   Examples: browser renderer, Electron main, Electron preload, Vite dev server, Node server, Electron-as-Node process, web worker, service worker, packaged app server.

4. Find the exact runtime that loads the failing code.
   Search imports, handlers, server entrypoints, IPC handlers, API routes, worker entrypoints, package scripts, and spawned commands.

5. Compare dev and production ownership.
   Check scripts and boot code for differences such as `vite`, `electron`, `node`, `ELECTRON_RUN_AS_NODE`, package server entries, workers, or bundled assets.

6. Inspect scripts and config that blur the boundary.
   Look for commands that run one runtime through another, rebuild dependencies for a different runtime, bundle server-only modules into client code, or expose privileged APIs through preload/IPC.

7. Fix the ownership boundary first.
   Prefer aligning the script/runtime with the intended architecture over adding retries, reinstall steps, broad fallbacks, or library swaps.

## Decision Guide

- If the browser or renderer initiates the action but an API route performs the side effect, debug the API runtime.
- If Electron main or preload imports the failing dependency directly, debug the Electron runtime.
- If a worker imports the failing dependency, debug the worker's build target and runtime.
- If dev and production run different server entries, verify both paths intentionally load the same dependencies.
- If one dependency is loaded by multiple runtimes, treat it as an architecture decision: split ownership, use separate build outputs, or choose a dependency that supports both runtimes.

## Output Format

When reporting findings, keep the answer concrete:

```text
User action:
Execution path:
Runtime that loads the failing code:
Boundary mismatch:
Recommended fix:
```

Add a short "why this keeps happening" explanation when the bug recurs after rebuilds, restarts, installs, or packaging.

## Avoid

- Do not assume the visible layer is the failing runtime — the UI surfaces the error, but the side effect (DB write, file read, native call) usually executes one or more boundaries away.
- Do not recommend reinstalling or rebuilding before identifying which runtime needs the artifact — `npm rebuild` compiles native modules against whichever Node ABI invoked it, which is often not the Electron ABI that will actually load them, so the rebuild "fixes" the wrong target.
- Do not blame a library until the runtime boundary and ownership path are clear — most "library bugs" in this class are really the right library loaded by the wrong runtime.
- Do not collapse dev and production behavior into one explanation when boot paths differ — dev typically runs through a dev server (Vite, tsx, electron + vite) while production runs a bundled entry, and they can import entirely different files for the same logical module.
