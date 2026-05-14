# Boundary Recipes

One recipe per boundary type. Each recipe specifies: **event-name shape**, **log level**, **fields**, **catch placement**. Apply literally — do not improvise field names.

`log` is the import path you wrote down at the end of SKILL.md Phase 2. Replace `log` below with whatever the project actually exports.

---

## outbound-http

Two log calls: dispatched (info) + failure (error). Success at info is optional — keep it only if the response body shape is small and useful.

```ts
log.info({ event: "<domain>.<verb>.dispatched", method, url, requestId });
try {
  const res = await fetch(url, opts);
  if (!res.ok) {
    log.warn({ event: "<domain>.<verb>.non_2xx", status: res.status, url });
  }
  return res;
} catch (err) {
  log.error({ event: "<domain>.<verb>.failed", url, err });
  throw err;
}
```

**Never** log the full request body if it may contain auth headers, tokens, PII, or large payloads. Log a content-length / shape hint instead.

---

## inbound-http (route handlers, webhook receivers, server fns)

Log on entry (info) and on caught error (error). Success exit is implied by the framework's access log — don't double-log.

```ts
log.info({ event: "<domain>.<verb>.received", route, requestId });
try {
  // handler body
} catch (err) {
  log.error({ event: "<domain>.<verb>.handler_failed", route, err });
  throw err;
}
```

For webhooks specifically: include the provider's event id (`stripe.event.id`, `github.delivery`) so duplicate-delivery debugging is possible.

---

## ipc-send / ipc-recv (Electron)

Both sides log. Use a shared correlation id when one is available.

```ts
// renderer
log.debug({ event: "ipc.<channel>.invoked", channel, payloadShape });
const result = await ipcRenderer.invoke(channel, payload);

// main
ipcMain.handle(channel, async (_e, payload) => {
  log.info({ event: "ipc.<channel>.received", channel });
  try { return await handler(payload); }
  catch (err) { log.error({ event: "ipc.<channel>.failed", channel, err }); throw err; }
});
```

---

## spawn / exec / fork

Log the resolved command (not the raw template), the cwd, and the exit code.

```ts
log.info({ event: "spawn.<purpose>.starting", cmd, args, cwd });
const child = spawn(cmd, args, { cwd, env });
child.on("exit", (code, signal) => {
  if (code === 0) log.info({ event: "spawn.<purpose>.exited", code });
  else log.error({ event: "spawn.<purpose>.failed", code, signal });
});
```

Capture stderr to the logger if the child doesn't already log structured output:

```ts
child.stderr.on("data", (chunk) =>
  log.warn({ event: "spawn.<purpose>.stderr", chunk: chunk.toString() })
);
```

---

## env-injection

The most common silent-failure site: an env var the parent thought it injected but didn't. Log the *names* of every var injected (never the values for secrets).

```ts
const env = { ...process.env, FOO: foo, BAR: bar, TOKEN: token };
log.info({
  event: "env.<purpose>.injected",
  names: ["FOO", "BAR", "TOKEN"],
  missing: ["FOO","BAR","TOKEN"].filter((k) => env[k] == null),
});
```

If `missing` is non-empty at runtime, that's the bug. Logging it upfront eliminates 30 minutes of `/fix-bug` time later.

---

## file-write (config, settings, on-disk artifacts)

Log absolute path, byte count, and whether the parent directory had to be created.

```ts
const abs = path.resolve(target);
const created = !existsSync(path.dirname(abs));
await fs.mkdir(path.dirname(abs), { recursive: true });
await fs.writeFile(abs, payload);
log.info({ event: "file.<purpose>.written", path: abs, bytes: payload.length, mkdirNeeded: created });
```

Never log the file *contents* unless they are small and non-sensitive.

---

## queue (enqueue + handler)

Both ends log; share a job id field name across producer and consumer so a `rg event:queue.<name>` returns the full lifecycle.

```ts
// producer
const job = await q.add(name, data);
log.info({ event: "queue.<name>.enqueued", jobId: job.id });

// consumer
q.process(name, async (job) => {
  log.info({ event: "queue.<name>.started", jobId: job.id });
  try { const r = await handler(job.data); log.info({ event: "queue.<name>.completed", jobId: job.id }); return r; }
  catch (err) { log.error({ event: "queue.<name>.failed", jobId: job.id, err }); throw err; }
});
```

---

## hook (Claude Code hooks, framework lifecycle hooks)

Hooks are the canonical "fired silently or didn't fire at all" surface. Always log on entry, before any conditional skip.

```bash
# in a bash hook
echo "{\"event\":\"hook.<name>.fired\",\"ts\":\"$(date -Iseconds)\",\"args\":\"$*\"}" >> "$LOG_FILE"
```

```ts
// in a TS hook handler
log.info({ event: "hook.<name>.fired", input });
// ...skip logic...
if (shouldSkip) {
  log.info({ event: "hook.<name>.skipped", reason });
  return;
}
```

The skip log is as important as the fire log — `/fix-bug` needs to know whether the hook ran-and-skipped vs. never fired.

---

## mcp (tool handlers)

```ts
server.tool(name, async (args) => {
  log.info({ event: "mcp.<tool>.called", argShape: Object.keys(args) });
  try { const r = await impl(args); return r; }
  catch (err) { log.error({ event: "mcp.<tool>.failed", err }); throw err; }
});
```

Do not log full `args` — MCP tool arguments often contain user prompts and file contents.

---

## silent-failure replacement

The replacement table from SKILL.md Phase 4 in expanded form:

```ts
// Before
result.thing?.() || true;
// After (preserve swallow semantics, add evidence)
try { result.thing?.(); } catch (err) { log.error({ event: "<site>.swallowed", err }); }
```

```ts
// Before
doStuff().catch(() => {});
// After
doStuff().catch((err) => log.error({ event: "<site>.swallowed", err }));
```

```bash
# Before
some-command >/dev/null 2>&1
# After (option A — keep silence, add a pre-call breadcrumb)
echo "{\"event\":\"<site>.dispatched\"}" >> "$LOG_FILE"
some-command >/dev/null 2>&1
# After (option B — capture errors)
some-command >>"$LOG_FILE" 2>&1
```

Pick option A when stdout is intentionally suppressed (e.g. wrapping a chatty tool); option B when the suppression was lazy.

---

## Field name discipline

Keep field names consistent across recipes. Canonical set:

| Field | Type | When |
|---|---|---|
| `event` | string `<domain>.<verb>` | always |
| `err` | Error | error logs |
| `requestId` / `jobId` | string | when a correlation id exists |
| `path` | absolute string | file ops |
| `url` | string | http |
| `method` | string | http |
| `status` | number | http response |
| `cmd` / `args` / `cwd` | string / string[] / string | spawn |
| `route` | string | inbound http |
| `channel` | string | ipc |

If you need a new field, add it here — do not invent ad-hoc names per file.
