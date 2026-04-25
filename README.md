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
pnpm dev                # runs Vite dev server + Electron in parallel
```

The first run creates `~/Library/Application Support/MissionControl/missioncontrol.db` (macOS) or the equivalent on Linux/Windows.

### Build

```bash
pnpm build              # builds web client + server + Electron
pnpm package            # rebuilds native deps for Electron and produces dist/
```

### Native module rebuild

`better-sqlite3` and `node-pty` have native bindings, but they do not need the same ABI in development:

- `better-sqlite3` is loaded by the Vite/TanStack server under stock Node, so `pnpm dev`, `pnpm test`, and `pnpm db:*` first rebuild it for the current Node runtime.
- `node-pty` only runs inside Electron, so postinstall and `pnpm dev:electron` rebuild it for Electron.

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

### Endpoints (UI — no auth needed; localhost only)

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

## Skill file for external CLIs

A drop-in skill for Claude Code / Codex / Cursor CLI lives in `docs/skills/missioncontrol-notify.md`. Paste it into the CLI's instructions or memory so the agent knows to POST its lifecycle events back to MissionControl.

## License

Proprietary — internal use only.
