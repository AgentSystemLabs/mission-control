# Classification Decision Tree

Every flagged construct gets exactly one label: **MECHANICAL**, **STRUCTURAL**, or **LEGITIMATE**.

---

## Step 1 — Is it on a boundary?

A **boundary** is where untrusted data enters the program. These count:

- HTTP route handler params: `req.body`, `req.query`, `req.params`, `searchParams`
- TanStack Start / tRPC / Next server function input
- Webhook payload bodies
- Queue / job worker message bodies
- IPC messages: Electron `ipcMain` handler args, `postMessage` data, `BroadcastChannel`
- `JSON.parse(...)` of any string sourced from disk, network, env, or stdin
- `process.env.X` reads consumed beyond simple presence checks
- `fetch(...).then(r => r.json())` results
- File contents read with `fs.readFile` and parsed
- WebSocket message payloads
- Form submissions parsed without an existing validator

These do **not** count as boundaries:
- Internal function calls between modules in the same package
- Database query results from your own typed schema (already validated by the schema layer)
- Constants defined in source code
- React component props (the parent is internal)

If the occurrence is at a boundary AND there's no validator wrapping the input → **STRUCTURAL** if it requires a non-trivial schema; **MECHANICAL** if the shape is one or two known fields.

---

## Step 2 — Is the type knowable from local context?

For `: any` and `as T`:

- Call sites all pass the same concrete shape that's visible in the file → **MECHANICAL**, infer the type.
- The value flows from a generic library type that the compiler refuses to narrow → **LEGITIMATE** if removing it breaks the build; annotate with `// HARDEN-OK`.
- The value's true shape depends on runtime branching the types don't model → **STRUCTURAL**, surface to user.

For `as unknown as T`:

- Always **STRUCTURAL** unless the source is one of: a validated parse output (in which case the cast is redundant — **MECHANICAL**, remove it) or a known-safe internal serialization (rare).

---

## Step 3 — Is it a discriminated-union narrowing?

```ts
if (msg.kind === 'ping') {
  const p = msg as PingMessage  // compiler often can't narrow across function boundaries
}
```

- If removing the cast breaks the build, it's **LEGITIMATE**.
- Annotate: `// HARDEN-OK: discriminated narrowing — kind === 'ping'`.
- Consider whether the union could be modeled with a function that returns the narrowed type — that's a STRUCTURAL improvement, not a mechanical fix.

---

## Step 4 — Is it a `@ts-ignore` / `@ts-expect-error`?

Re-run typecheck on the file with the directive temporarily removed:

- If no error appears → **MECHANICAL**, delete the directive.
- If an error appears and the line is genuinely correct (compiler bug, library type bug) → **LEGITIMATE**, replace `@ts-ignore` with `@ts-expect-error` plus a one-line reason if missing.
- If an error appears and the line has a real bug → **STRUCTURAL**, surface to the user. Do not silently delete the directive.

---

## Step 5 — Missing return type on exported function

- Body returns a literal-typed expression → **MECHANICAL**, add the inferred type.
- Body's return type is a complex generic the inference produces correctly but verbosely → **LEGITIMATE** if a project convention allows inferred returns on exports; otherwise **MECHANICAL**, add a named type alias.
- Body returns something with `any` in it → fix the inner `any` first; the return type follows.

---

## When in doubt

Prefer **STRUCTURAL** over **MECHANICAL**. A reported item the user can review is cheaper than an automatic fix that breaks the build or hides a runtime bug.
