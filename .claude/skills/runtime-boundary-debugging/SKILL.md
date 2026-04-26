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

1. **Map the call chain.** Name the failing user action, trace it across every boundary crossing (UI event → fetch/IPC/worker message/spawned process → DB/FS/native call), and label each hop with its runtime (browser renderer, Electron main/preload, Vite dev server, Node server, `ELECTRON_RUN_AS_NODE` child, web worker, service worker, packaged app server).

2. **Pin the runtime that actually loads the failing code.** At the suspected load site, prove it with a runtime probe rather than guessing from imports:
   - Node vs Electron: log `process.versions.node` and `process.versions.electron` (only the latter is set inside Electron).
   - Electron main vs renderer vs preload: check `process.type` (`'browser'` = main, `'renderer'`, `'worker'`, or `undefined`).
   - Browser vs server bundle: `typeof window === 'undefined'`, `import.meta.env.SSR`, or framework equivalents (`'use server'`, Next.js `headers()` boundary).
   - Worker vs main thread: `typeof WorkerGlobalScope !== 'undefined'` or the Node `worker_threads` `isMainThread`.
   - Which binary launched it: inspect the parent process and the actual path of `node`/`electron`/`bun` on `PATH`; module ABI mismatches almost always trace here.

3. **Compare dev vs production boot paths.** Read both entry scripts in `package.json` and any builder config. Note differences in launcher (`vite`, `electron .`, `node dist/...`, `electron-forge start` vs packaged binary), `main`/`exports` fields, env (`NODE_ENV`, `ELECTRON_RUN_AS_NODE`), and which files each path actually loads. Same logical module can resolve to different files.

4. **Inspect boundary-blurring scripts and config.** Flag: `npm rebuild`/`electron-rebuild` targeting the wrong ABI, server-only modules pulled into a client bundle, preload scripts exposing privileged APIs over IPC, conditional `exports` (`node`/`browser`/`electron`) picking the wrong subpath, externalized vs bundled deps in the production build.

5. **Fix the ownership boundary first.** Align the script/runtime with the intended architecture before reaching for retries, reinstalls, broad fallbacks, or library swaps. If two runtimes legitimately need the dep, treat it as an architecture decision (see Decision Guide).

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
