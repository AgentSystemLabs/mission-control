# [LOW] Dynamic `await import("~/server/auth")` in `src/lib/api.ts` widens bundler entry surface

**Files:** `src/lib/api.ts:50-58` (`resolveApiToken` SSR branch), `src/lib/electron.ts` (separate but related)
**Category:** Client-bundle hygiene / supply-chain footgun
**Severity:** Low
**Surfaced by:** reviewer-security-regression + reviewer-client-bundle implications of bug 03 fix (2026-05-16)

## What's wrong

To let SSR loaders authenticate their own loopback fetches without seeding `process.env.MC_API_TOKEN` (which would inherit into every spawned child via `process.env`), `src/lib/api.ts:resolveApiToken` dynamic-imports the server helper:

```ts
// src/lib/api.ts:50-58
if (import.meta.env.SSR) {
  try {
    const { getServerApiToken } = await import("~/server/auth");
    return getServerApiToken();
  } catch {
    return null;
  }
}
```

`import.meta.env.SSR` is a Vite compile-time constant; the branch is statically `false` in the client bundle and the import should be tree-shaken. **Today this works correctly** — `src/server/auth.ts` transitively pulls `better-sqlite3` via `services/settings` → `repositories/app-settings.repo` → `~/db/client`, none of which appear in the client chunk.

The risk is **brittle to bundler upgrades and to changes in `src/lib/electron.ts`**:

1. Any future Vite/Rollup change that stops constant-folding `import.meta.env.SSR` would silently start including `~/server/auth` (and its native-binding transitive deps) in the client bundle.
2. Separately, `src/lib/api.ts:resolveApiToken` *also* does `await import("./electron")` in the renderer branch (line 64). `src/lib/electron.ts` is 20 lines today and safely client-only — but anyone who adds a `~/server/...` import to it (even indirectly, e.g. for a shared type) will silently leak server-only modules into the client bundle through that dynamic import.

Either path becoming a bundle leak would:
- Ship `better-sqlite3` / `node-pty` native bindings to the renderer (they'd fail to load, breaking the app).
- Or, more insidiously, ship parts of the server's persistence/auth code into the renderer where a content-script / extension could read literal token-handling code.

## Why fixing this is important — what could go wrong

This is "hygiene that prevents a future foot-gun." There's no active vulnerability today. The class of bug it prevents is:

- A junior dev refactors `src/lib/electron.ts` to "share a type" with `~/server/types`, accidentally importing a function alongside the type re-export. Client bundle silently grows by hundreds of KB and may include a copy of the API token handling logic.
- A bundler upgrade changes dead-code-elimination behavior. The dynamic SSR import is no longer pruned. Client bundle ships server code.

## How to fix it

### Option A: ESLint `no-restricted-imports` guard

Add a `.eslintrc` (or extend the existing config) rule that forbids any import from `~/server/**` inside `src/lib/**` and `src/components/**` (client-only directories), with an explicit exception for `src/lib/api.ts:resolveApiToken`.

```jsonc
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [{
        "group": ["~/server/*", "~/server/**"],
        "message": "Server-only modules must not be imported from client code. If you need a server-side helper at SSR time, use a dynamic import guarded by `import.meta.env.SSR` and add the file to the eslint allow-list."
      }]
    }]
  }
}
```

The dynamic import in `src/lib/api.ts:51` would need a per-file `// eslint-disable-next-line` with a comment pointing at this finding.

### Option B: bundle-introspection test

Add a post-build assertion that runs after `pnpm build`:

```ts
// scripts/assert-client-bundle-clean.ts
import * as fs from "node:fs";
import * as path from "node:path";

const clientDir = "dist/client/assets";
const FORBIDDEN = ["better-sqlite3", "getOrCreateApiToken", "import.meta.env.SSR"];
const files = fs.readdirSync(clientDir).filter((f) => f.endsWith(".js"));
for (const f of files) {
  const src = fs.readFileSync(path.join(clientDir, f), "utf8");
  for (const needle of FORBIDDEN) {
    if (src.includes(needle)) throw new Error(`client bundle leaks ${needle} via ${f}`);
  }
}
```

Wire as a `posttest` or CI step. Catches both the dynamic-import-leak path and any other accidental server-symbol-in-client-bundle case.

### Option C: full client/server boundary helper

Replace both the SSR and the client paths in `resolveApiToken` with a single seam:

- Server side: write `getServerApiToken` into `~/server/auth` and have the TanStack Start server entry call `resolveApiToken.setBootstrap(getServerApiToken)` at boot. The lib has no awareness of `~/server/*`.
- Client side: leave the lazy `getElectron()` IPC fallback as-is.

Costs an extra wiring line at the server entry; cleanly removes the cross-layer dynamic import.

Option A is the cheapest win and worth doing regardless. Options B/C are appropriate if this surface grows.

## Cross-references

- The `process.env.MC_API_TOKEN` seed approach was the alternative considered and rejected during bug 03 fix because it widens the token's blast radius to every spawned child process inheriting `process.env`. See the comment on `getServerApiToken` in `src/server/auth.ts`.
- This finding pairs with bug 16 (structural CI guard for the auth gate) — both are about catching architectural regressions before they ship.
