# MissionControl

Desktop control surface for managing agentic coding work (Claude Code / Codex / Cursor CLI) across many projects. Built as an Electron app that wraps a TanStack Start server, with SQLite + Drizzle for local persistence and real PTYs (via `node-pty` + `xterm.js`) so you can run real interactive CLI agents inside the app.

## Why this exists

Cursor and Codex bury your projects in a collapsable left rail. MissionControl flips it: every project gets a card on a single home view, with at-a-glance counts of how many agents are running, awaiting input, or done. Click into a project, see its tasks split by status, toggle three of them on at once and three real terminals split horizontally on the right. External CLI tools can POST status back to the app over a localhost API.

## Features

- Mission Control grid with pinned / grouped / ungrouped sections, density toggle, and search
- Project add/edit/remove (remove only unlinks — never touches files)
- Project grouping with colored dots
- Project detail view: tasks split into Needs-input / Running / Done columns
- Multi-select tasks → split-pane terminals (cap of 4)
- New-agent launcher for Claude Code / Codex / Cursor CLI / plain shell
- External REST API + Server-Sent Events for live UI updates
- Bearer-token auth for the writable endpoints
- Bound to `127.0.0.1` only — never exposed to LAN
- Dark + light themes matching the prototype's design tokens

## Stack

- Electron 41+ shell
- TanStack Start (file-based React routes + server file routes for `/api/*`)
- Vite 7 + Tailwind v4 + Geist / Geist Mono
- SQLite (`better-sqlite3`) + Drizzle ORM
- `node-pty` + `@xterm/xterm` + `@xterm/addon-fit`
- Server-Sent Events for live updates (no socket.io / Redis)

## Repo layout

```
mission-control/
├── electron/               Electron main + preload + PTY manager
│   ├── main.ts
│   ├── preload.ts
│   └── pty-manager.ts
├── src/
│   ├── client.tsx          TanStack Start client entry
│   ├── ssr.tsx             TanStack Start server entry
│   ├── router.tsx
│   ├── styles.css          Design tokens + keyframes
│   ├── routes/
│   │   ├── __root.tsx
│   │   ├── index.tsx       Mission Control
│   │   ├── projects.$id.tsx
│   │   ├── archive.tsx
│   │   ├── settings.tsx
│   │   └── api/            Server file routes (REST + SSE)
│   ├── components/
│   │   ├── ui/             Icon, Btn, Modal, TextField, etc.
│   │   └── views/          ProjectCard, TaskCard, TerminalPane, dialogs
│   ├── server/
│   │   ├── auth.ts         Bearer token middleware + json helpers
│   │   ├── events.ts       In-process event bus for SSE
│   │   └── services/       projects, groups, tasks
│   ├── db/
│   │   ├── schema.ts       Drizzle schemas
│   │   ├── client.ts       better-sqlite3 + ensureSchema
│   │   └── settings.ts     api_token + key/value helpers
│   └── lib/
│       ├── api.ts          Typed fetch client
│       ├── electron.ts     window.electronAPI typed bridge
│       └── design-meta.ts  Agent + status metadata
├── designs/                Original HTML+JSX prototype (source of truth)
├── SPEC.md                 Approved product spec
└── README.md
```

## Getting started

```bash
pnpm install            # installs deps; postinstall rebuilds Electron PTY bindings
pnpm dev:electron       # runs Vite dev server + Electron
```

The first run creates `~/Library/Application Support/MissionControl/missioncontrol.db` (macOS) or the equivalent on Linux/Windows.

### Remote VM Sandboxes

Mission Control can provision AWS EC2 instances with
`mission-control-agent` installed directly on the VM host. Create one from a
project page (**Create sandbox**), or use the CLI:

```bash
pnpm remote-vm deploy aws --name client-vm --region us-east-1
```

Defaults to a **`t3.medium`** (2 vCPU, 4 GiB) in `us-east-1` (~**$30/mo** on-demand if
left running 24/7; less with the built-in 30-minute idle auto-stop). Override with
`--size` or `--idle-timeout`.

See [docs/remote-vm-cli.md](docs/remote-vm-cli.md) for AWS flags,
bootstrap details, and cleanup commands.

### Build

```bash
pnpm build              # builds web client + Electron
pnpm package            # rebuilds native deps for Electron and produces dist/
```

### Native module rebuild

`better-sqlite3` and `node-pty` have native bindings, but they do not need the same ABI in development:

- `better-sqlite3` is loaded by the Vite/TanStack server under stock Node, so `pnpm dev`, `pnpm dev:electron`, `pnpm test`, and `pnpm db:*` first rebuild it for the current Node runtime.
- `node-pty` only runs inside Electron, so postinstall rebuilds it for Electron.

When you need both native modules rebuilt for Electron (for example before packaging), run:

```bash
pnpm rebuild
```

## External API

When MissionControl is running, it binds an HTTP server on `127.0.0.1:<port>`. The port is written to `$USER_DATA_DIR/.port` and shown in the Settings page along with the bearer token.

### Endpoints (writable — bearer token required)

| Method | Path                                   | Description                                  |
| ------ | -------------------------------------- | -------------------------------------------- |
| POST   | `/api/projects/:id/tasks`              | Create a task scoped to a project            |
| POST   | `/api/tasks/:id/status`                | Update a task's status / preview / line count |

### Example: mark a task done

```bash
curl -H "Authorization: Bearer $TOKEN" \
  -X POST http://127.0.0.1:$PORT/api/tasks/$TASK_ID/status \
  -d '{"status":"done","preview":"All tests passing"}'
```

The UI updates within ~1 second over its SSE connection.

### Endpoints (localhost only; bearer-token required on every route)

All `/api/*` routes require an `Authorization: Bearer <token>` header (token in
Settings → API). The renderer attaches it automatically; external CLIs (Claude,
Codex, Cursor) receive it via the `$MC_API_TOKEN` env var when launched from
within Mission Control. `/api/events` (SSE) uses a short-lived ticket from
`POST /api/events/ticket` because `EventSource` cannot send custom headers.


| Method | Path                                   |
| ------ | -------------------------------------- |
| GET    | `/api/projects`                        |
| POST   | `/api/projects`                        |
| GET    | `/api/projects/:id`                    |
| PATCH  | `/api/projects/:id`                    |
| DELETE | `/api/projects/:id`                    |
| GET    | `/api/groups`                          |
| POST   | `/api/groups`                          |
| PATCH  | `/api/groups/:id`                      |
| DELETE | `/api/groups/:id`                      |
| GET    | `/api/projects/:id/tasks`              |
| GET    | `/api/tasks/:id`                       |
| PATCH  | `/api/tasks/:id`                       |
| POST   | `/api/tasks/:id/archive`               |
| POST   | `/api/tasks/:id/restore`               |
| GET    | `/api/archive`                         |
| GET    | `/api/events` (SSE)                    |
| GET    | `/api/settings`                        |
| POST   | `/api/settings` (regenerate token)     |

## Observability

Main-process logs are written via `electron-log`. In a packaged build they persist to:

- **macOS:** `~/Library/Logs/MissionControl/main.log`
- **Windows:** `%USERPROFILE%\AppData\Roaming\MissionControl\logs\main.log`
- **Linux:** `~/.config/MissionControl/logs/main.log`

In dev (`pnpm dev`) the same lines are written to stdout/stderr.

### Event prefixes

| Prefix | Surface | Dispatch sites |
| --- | --- | --- |
| `update.check.*` | Auto-updater check lifecycle (entry, failure) | `electron/update-manager.ts:safeCheck` |
| `update.download.*` | Auto-updater download lifecycle | `electron/update-manager.ts:safeDownload` |
| `update.install.*` | Auto-updater install lifecycle | `electron/update-manager.ts:safeInstall` |
| `update.state.*` | Auto-updater UpdateState transitions (sampled at 10% boundaries for downloading) | `electron/update-manager.ts:broadcast` |
| `update.error.*` | Errors emitted by electron-updater itself | `electron/update-manager.ts:wireEvents` |
| `update.load.*` | electron-updater module load failure | `electron/update-manager.ts:loadUpdater` |

When investigating "the update never installed," start with `rg 'event: "update\.' ~/Library/Logs/MissionControl/main.log`. electron-updater's own internal log stream (URL resolution, signature verification, retries) is also routed into the same file.

## Skill file for external CLIs

A drop-in skill for Claude Code / Codex / Cursor CLI lives in `docs/skills/missioncontrol-notify.md`. Paste it into the CLI's instructions or memory so the agent knows to POST its lifecycle events back to MissionControl.

## License

[MIT](LICENSE)
