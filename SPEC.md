# MissionControl — Product Spec (v1)

## Vision

A focused desktop app that helps developers manage agentic coding work across many projects without the cluttered sidebar of Cursor/Codex/etc. Each project gets a card on a single Mission Control surface. Click in, see exactly what your agents are doing, open multiple terminal sessions side-by-side, and get back to the home view in one click. The app is an Electron shell wrapping a TanStack Start app — Electron because we need a long-lived process that can expose local HTTP endpoints other CLI tools can post to (status updates, completion signals).

## Target User

Solo developers and small teams running multiple AI coding agents (Claude Code, Codex, Cursor CLI) across multiple repos. The kind of person who context-switches across 5+ git repositories in a single day and is frustrated with Cursor/Codex's collapsable-tree sidebar UX.

## Core Job

Show me at a glance which projects need my attention and let me pop into a project to drive its agents — preferably without ever scrolling a sidebar.

## Goals & Non-Goals

### Goals (v1)

- Single Mission Control grid view of project cards with at-a-glance status (running / needs-input / done counts)
- Add/remove projects by working directory, pin to top, organize into groups
- Project detail view with tasks broken into Needs-input / Running / Done columns
- Multi-select tasks → opens a terminal panel that splits horizontally to show all selected sessions concurrently
- "New agent" picker (Claude Code / Codex / Cursor CLI) that spawns a real PTY in the project's working directory and starts the chosen CLI
- Archive done tasks; restore from archive view
- HTTP API exposed by Electron so external CLI agents can POST status updates back to the app (e.g. `running → needs-input → done`)
- SQLite-backed local persistence (no cloud)
- Dark + light theme matching the design tokens in `designs/`

### Non-Goals (v1)

- No user accounts, no multi-user — local single-user app (the HTTP API is bearer-token gated; see Auth & Authorization below)
- No cloud sync or remote storage
- No in-app AI agent orchestration — we spawn the user's installed CLIs and act as a shell + status board
- No built-in code editor or diff viewer (clicking a task opens its terminal; that's it)
- No web mode — Electron only
- No mobile
- No analytics, no telemetry
- No PR/commit creation flows beyond shelling out to the CLI agents
- No marketing site, no landing page

## Features

### Feature 1: Mission Control grid

- **Story:** As a developer, I want to see all my projects on one screen with high-level status so I know which one to focus on next.
- **Acceptance:**
  - [x] Shows pinned projects in their own section at the top
  - [x] Shows projects grouped by group (each group has a colored dot label)
  - [x] Shows ungrouped projects in their own section
  - [x] Each card shows project icon, name, working directory, current branch, count pills for running/needs-input/done, and a preview line of the most recent activity
  - [x] Search input filters by name and path
  - [x] Density toggle (compact / regular / spacious) re-flows the grid
  - [x] Animated shimmer bar on cards with running activity
  - [x] Empty state when no projects exist
- **Priority:** P0
- **Status:** Done

### Feature 2: Project CRUD + grouping + pinning

- **Story:** As a developer, I want to add a project from a working directory, pin it, group it, and rename it.
- **Acceptance:**
  - [x] "Add project" dialog with: name, working directory (with native folder browser via Electron dialog), 2-letter icon initials, icon color (palette), group selection
  - [x] Edit project dialog with the same fields
  - [x] Pin/unpin from the card
  - [x] Manage groups dialog: add/rename/remove groups; removing a group leaves its projects ungrouped
  - [x] Removing a project unlinks it from the app — does not delete files on disk
  - [~] Working directory is validated (must exist, must be a directory) — validated on create, not on edit-rename
  - [x] Branch is auto-detected from `.git/HEAD` and refreshed on project view open
- **Priority:** P0
- **Status:** Done (path-validation-on-edit minor gap)

### Feature 3: Project detail view

- **Story:** Once I'm in a project, I want to see all its tasks separated by status so I can focus on the ones that need me.
- **Acceptance:**
  - [x] Project header shows icon, name, path, current branch
  - [x] Active tab shows three columns/sections: Needs input → Running → Done
  - [x] Each task card shows status, agent (Claude Code/Codex/Cursor CLI with glyph), title, branch, +lines, last-updated, and a preview line
  - [x] Task cards in "running" state show a shimmering top border and animated caret
  - [x] Task cards in "done" state show a "Commit & push" button (shells out via terminal) and "Archive" button
  - [x] Task cards in "needs-input" state show "Open terminal to reply"
  - [x] Archive tab shows archived tasks with a "Restore" action
  - [x] Empty state when no active tasks
- **Priority:** P0
- **Status:** Done

### Feature 4: Multi-terminal split panel

- **Story:** I want to toggle on 3 tasks at once and see all 3 terminals stacked side-by-side so I can babysit them in parallel.
- **Acceptance:**
  - [x] Selecting a task card adds its terminal to a right-side panel
  - [x] Multiple selected tasks stack horizontally (split by `flex: 1` so they share height)
  - [x] Each pane has a header showing project icon, task title, agent label, status indicator
  - [x] Each pane has a close button; "Close all" closes all panes
  - [x] Each pane is a real `node-pty` PTY backed by xterm.js — actual interactive terminal, not a fake transcript
  - [x] Terminals persist their PTY across project navigation (closing a terminal pane kills the PTY; navigating away does not)
  - [x] Resize on viewport change is wired up so xterm.js fits its container
  - [x] Cap of 4 simultaneous open terminals (oldest is dropped when 5th is opened)
- **Priority:** P0
- **Status:** Done

### Feature 5: New agent launcher

- **Story:** I want to start a new Claude Code / Codex / Cursor CLI session inside a project's working directory.
- **Acceptance:**
  - [x] Dialog shows the three agents with description and command preview
  - [x] Lets me set a task title and target git branch (defaults to current branch)
  - [x] On submit: creates a Task row, spawns a PTY in the project's `path`, runs the chosen CLI command (`claude`, `codex`, `cursor-agent`), and auto-opens the new terminal in the panel
  - [x] Initial task status is `running`
  - [x] If the chosen CLI is not on PATH, show an inline error in the dialog
- **Priority:** P0
- **Status:** Done (also added a 4th `shell` agent variant for raw interactive sessions)

### Feature 6: External status API

- **Story:** When a CLI agent finishes its task, it should be able to POST back to the app to flip the task's status to `done` (or `needs-input` if it has a question).
- **Acceptance:**
  - [x] Electron main process exposes a localhost HTTP server (e.g. `http://127.0.0.1:<port>`) that hosts the TanStack Start app and an `/api` namespace
  - [x] `POST /api/tasks/:id/status` accepts `{ status: "running"|"needs-input"|"done", preview?: string, lines?: number }` and updates the task; the UI reflects the change live
  - [x] `POST /api/tasks` accepts a payload to create a new task scoped to a project (so a CLI can spawn its own) — exposed at `POST /api/projects/:id/tasks`
  - [x] Endpoints require a per-install API token (32 random bytes hex) sent in `Authorization: Bearer <token>`; token shown in Settings and copyable
  - [x] Live updates flow to the renderer via SSE or a polling fallback (whichever is simpler with TanStack Start)
- **Priority:** P0
- **Status:** Done (verified end-to-end with curl smoke test: create project → create task → POST status → 401 without token)

### Feature 7: Theme + design fidelity

- **Story:** The app should match the look-and-feel of the prototype in `designs/` exactly.
- **Acceptance:**
  - [x] All design tokens from `designs/MissionControl.html` are extracted to a global CSS file (CSS custom properties)
  - [x] Geist + Geist Mono fonts loaded
  - [x] Dark theme matches the prototype pixel-for-pixel
  - [~] Light theme variant works (matches `[data-theme="light"]` overrides in the prototype) — page chrome is themed; xterm terminal interior stays dark
  - [x] Animations carried over: `shimmer`, `pulse-dot`, `caret`, `fade-up`, `slide-right`
  - [x] Dot-grid background on main views
  - [x] Custom scrollbars per the prototype
- **Priority:** P0
- **Status:** Done (light-mode xterm theming is the only known gap)

### Feature 8: Persistence

- **Story:** All my projects, groups, tasks, and pins survive an app restart.
- **Acceptance:**
  - [x] SQLite database at `app.getPath('userData')/missioncontrol.db`
  - [x] Drizzle ORM with `better-sqlite3` driver
  - [ ] Migrations checked in under `src/db/migrations/` — currently uses inline `CREATE TABLE IF NOT EXISTS` bootstrap in `src/db/client.ts`; drizzle-kit generate not yet run
  - [~] On first launch, run pending migrations — schema is ensured idempotently on first DB open, but not via the migrator
  - [x] On schema change in dev, `pnpm db:push` regenerates and applies (drizzle.config.ts is wired)
- **Priority:** P0
- **Status:** Partial — schema works and persists, but migrator workflow needs to be swapped in for proper version tracking

## Data Model

### Entities

| Entity         | Fields                                                                                                                                                                                                                                                | Relations                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `groups`       | id (text, pk), name (text), color (text hex), createdAt (int, ms)                                                                                                                                                                                     | has many projects                  |
| `projects`     | id (text, pk), name (text), path (text — absolute working dir), icon (text, 2 chars), iconColor (text hex), groupId (text, fk → groups.id, nullable), pinned (int 0/1), branch (text), createdAt, updatedAt                                            | belongs to group, has many tasks   |
| `tasks`        | id (text, pk), projectId (text, fk → projects.id), title (text), agent (enum: claude-code/codex/cursor-cli), status (enum: running/needs-input/done), branch (text), preview (text), lines (int default 0), archived (int 0/1), updatedAt, createdAt | belongs to project                 |
| `terminal_logs`| id (text, pk), taskId (text, fk → tasks.id), chunk (text), createdAt                                                                                                                                                                                  | belongs to task                    |
| `app_settings` | key (text, pk), value (text)                                                                                                                                                                                                                          | singleton key/value (api token, theme) |

### Relationship Map

A `Group` has many `Projects`. A `Project` has many `Tasks`. A `Task` has zero or more `TerminalLogs` (raw stdout chunks for later search). Projects can be ungrouped (`groupId IS NULL`). `app_settings` is a flat key/value store for user preferences and the API token.

## Auth & Authorization

- **No user accounts** — single-user desktop app; the bearer token is the only credential.
- **HTTP API (UI and external):** every `/api/*` route requires `Authorization: Bearer <token>` (header — or `?token=` query for `/api/events` SSE, since `EventSource` cannot send headers). The renderer attaches the bearer automatically via the IPC-fetched token; external CLIs (Claude, Codex, Cursor) inherit `$MC_API_TOKEN` when launched from MC. Token generated on first launch, stored in `app_settings`, copyable from Settings → API.
- **Same-origin gate:** before bearer check, every `/api/*` request must come from a loopback `Origin`/`Host` to defeat DNS rebinding and cross-origin browser fetches.
- **Network bind:** API binds to `127.0.0.1` only. Never exposed to LAN.

## Pages & Routes

| Route                | Page                  | Auth        | Description                                                              |
| -------------------- | --------------------- | ----------- | ------------------------------------------------------------------------ |
| `/`                  | Mission Control       | none (UI)   | Grid of all project cards                                                |
| `/projects/:id`      | Project Detail        | none (UI)   | Tasks split by status + open-terminals panel                             |
| `/archive`           | Archive               | none (UI)   | All archived tasks across all projects                                   |
| `/settings`          | Settings              | none (UI)   | Theme, API token, keyboard shortcuts info                                |

## API Endpoints (TanStack Start server functions / route handlers)

| Method | Endpoint                            | Auth   | Description                                       |
| ------ | ----------------------------------- | ------ | ------------------------------------------------- |
| GET    | `/api/projects`                     | UI/SSR | List all projects (with task counts)              |
| POST   | `/api/projects`                     | UI/SSR | Create a project                                  |
| PATCH  | `/api/projects/:id`                 | UI/SSR | Rename, repath, repin, regroup                    |
| DELETE | `/api/projects/:id`                 | UI/SSR | Unlink (does not touch files)                     |
| GET    | `/api/groups`                       | UI/SSR | List groups                                       |
| POST   | `/api/groups`                       | UI/SSR | Create                                            |
| PATCH  | `/api/groups/:id`                   | UI/SSR | Rename                                            |
| DELETE | `/api/groups/:id`                   | UI/SSR | Remove (orphans projects to ungrouped)            |
| GET    | `/api/projects/:id/tasks`           | UI/SSR | List tasks for a project                          |
| POST   | `/api/projects/:id/tasks`           | Token  | Create a task (used by external CLIs)             |
| PATCH  | `/api/tasks/:id`                    | UI/SSR | Update title/branch                               |
| POST   | `/api/tasks/:id/status`             | Token  | External status push: running/needs-input/done    |
| POST   | `/api/tasks/:id/archive`            | UI/SSR | Archive                                           |
| POST   | `/api/tasks/:id/restore`            | UI/SSR | Restore                                           |
| GET    | `/api/events`                       | UI/SSR | SSE stream for live UI updates                    |

### Electron IPC channels (renderer ↔ main)

- `dialog:browseFolder` → opens native folder picker, returns path
- `pty:spawn` `{ taskId, cwd, command, args }` → spawns PTY, returns ptyId
- `pty:write` `{ ptyId, data }` → write to stdin
- `pty:resize` `{ ptyId, cols, rows }` → resize PTY
- `pty:kill` `{ ptyId }` → kill
- `pty:data` (push from main → renderer) → stream stdout chunks
- `pty:exit` (push from main → renderer) → exit code

## Stack

| Layer                | Choice                                                | Reason for override (vs default)                                          |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| **Shell**            | Electron 30+                                          | Required — exposes a local HTTP API + native PTY + folder dialogs          |
| **Web Framework**    | TanStack Start                                        | User-requested override (default was Next.js)                              |
| **Language**         | TypeScript (strict)                                   | default                                                                    |
| **UI**               | Tailwind + design tokens via global CSS               | matches the design system in `designs/`                                    |
| **DB**               | SQLite via `better-sqlite3` + Drizzle ORM             | User-requested override (default was Postgres) — local desktop app, no cloud |
| **Terminal**         | `node-pty` (main) + `xterm.js` + `xterm-addon-fit`    | Real PTY required for interactive CLI agents                               |
| **API**              | TanStack Start server route handlers                  | Single server inside Electron main                                         |
| **Live updates**     | Server-Sent Events                                    | Simpler than WebSockets and sufficient for state-change push               |
| **Packaging**        | electron-builder                                      | Cross-platform installer support                                           |
| **Native rebuild**   | electron-rebuild (better-sqlite3, node-pty)           | both have native bindings                                                  |
| **Auth**             | none for UI, bearer token for HTTP API                | Single-user local app                                                      |
| **Payments**         | none                                                  | Not in v1                                                                  |
| **Email**            | none                                                  | Not in v1                                                                  |
| **Testing**          | Vitest (unit) + Playwright Electron (e2e smoke)       | default                                                                    |
| **Deploy**           | n/a (desktop app)                                     | Distributed via electron-builder artifacts                                 |

### Why Electron + TanStack Start, not just one or the other

The user wants both: (1) a desktop app that owns local resources (PTYs, SQLite, file dialogs), and (2) a long-lived HTTP server that external CLI tools can POST to. Electron handles (1); embedding a TanStack Start server in Electron's main process handles (2) and gives us a real React+routing+SSR-capable UI. The Electron main process boots a TanStack Start server on `127.0.0.1:<random-port>`, then opens a `BrowserWindow` pointed at `http://127.0.0.1:<port>/`. External CLIs hit the same port at `/api/*` with the bearer token.

## Design Direction

- **Vibe:** Minimal, dense, terminal-influenced — Geist Mono everywhere for labels and metadata, Geist Sans for primary text, lots of subtle borders, dot-grid background, and soft shimmer animations to denote activity.
- **Color mode:** Both (with toggle in Settings); dark is the default.
- **Brand color:** Green `#7ce58a` (the prototype's accent). Color is themable in Settings.
- **Reference:** the `designs/` folder is the source of truth — the implementation should match it closely.
- **Key UI patterns:**
  - Project icon = 2-letter monogram with translucent gradient background
  - Status communicated by colored dot + colored shimmer bar (running) or static dot (needs-input/done)
  - Status pills (`◯ 3 running`, `◯ 1 needs input`, `◯ 5 done`) on cards
  - Modals are centered, blurred backdrop, top-right close button
  - Top bar always shows a clickable `MissionControl` logo crumb that returns to home

## Architecture Overview

```
┌─ Electron Main (Node.js) ────────────────────────────────────────┐
│                                                                   │
│   ┌──────────────────┐    ┌────────────────────────────────────┐  │
│   │ TanStack Start   │    │ PTY Manager (node-pty)             │  │
│   │ HTTP server      │    │   pty:spawn / pty:write / pty:data │  │
│   │   /             │    └────────────────────────────────────┘  │
│   │   /projects/:id  │    ┌────────────────────────────────────┐  │
│   │   /archive       │    │ SQLite (better-sqlite3)            │  │
│   │   /api/*         │←───│ Drizzle ORM + migrations           │  │
│   │   /api/events    │    └────────────────────────────────────┘  │
│   └──────────────────┘    ┌────────────────────────────────────┐  │
│           ↑               │ Event Bus (per-process emitter)    │  │
│           │               │   broadcasts task changes for SSE  │  │
│           │               └────────────────────────────────────┘  │
│   ┌──────────────────┐                                            │
│   │ BrowserWindow    │                                            │
│   │ loads localhost  │                                            │
│   └──────────────────┘                                            │
└───────────────────────────────────────────────────────────────────┘
       ↑                                  ↑
       │ IPC (PTY data, dialogs)          │ HTTP + bearer token
       │                                  │
┌──────┴──────────────┐         ┌─────────┴──────────────┐
│ Renderer (React UI) │         │ External CLI agents    │
│  + xterm.js         │         │  curl /api/tasks/:id/  │
└─────────────────────┘         └────────────────────────┘
```

The Electron main process is the only writer for SQLite. The TanStack Start server (running inside main) reads/writes via Drizzle. PTY lifecycle is owned by main; renderer talks to PTYs via IPC for performance. Server-side route handlers can also enqueue PTY commands but for v1 the renderer drives them.

## Task Breakdown

> Build order optimized for "see something on screen ASAP" then layer functionality.

### Stage 1 — Skeleton (S → M)

- [x] **T1: Repo scaffold** — `package.json`, TypeScript, `pnpm` workspace if needed (single package is fine), `.gitignore`, `tsconfig.json`, ESLint, Prettier
  - Skills: `architecture`, `clean-code`
  - Complexity: S
  - Dependencies: none
  - Status: Done. ESLint/Prettier deferred (typecheck is the gate).

- [x] **T2: Electron + TanStack Start integration** — Electron main spawns a TanStack Start server on `127.0.0.1:<random-port>`, BrowserWindow loads it. Verify dev mode (Vite HMR) works and prod build works.
  - Skills: `architecture`, `tanstack-start`
  - Complexity: L
  - Dependencies: T1
  - Status: Dev mode done — Electron waits on `wait-on tcp:5173` then loads `MC_DEV_URL`. Prod build path (`pnpm package`) wired but unverified.

- [x] **T3: Global design tokens + Tailwind setup** — port `--bg`, `--surface-*`, `--text*`, `--border*`, `--accent`, `--status-*`, `--mono`, `--sans`, `--radius-*` from `designs/MissionControl.html` to a global CSS file. Configure Tailwind to read those tokens. Add Geist + Geist Mono via `@fontsource`. Add the keyframes (`shimmer`, `pulse-dot`, `caret`, `fade-up`, `slide-right`).
  - Skills: `ui-design`
  - Complexity: M
  - Dependencies: T2
  - Status: Done. Tailwind v4 via `@tailwindcss/vite`.

- [x] **T4: SQLite + Drizzle setup** — `better-sqlite3`, schemas for `groups`, `projects`, `tasks`, `terminal_logs`, `app_settings`. Migration generation via `drizzle-kit`. Open DB at `app.getPath('userData')`. electron-rebuild config.
  - Skills: `database-design`, `architecture`
  - Complexity: M
  - Dependencies: T2
  - Status: Schema + drizzle-kit config + electron-rebuild postinstall done. Migration files not generated yet — bootstrap is inline `CREATE IF NOT EXISTS`.

### Stage 2 — Core UI (M → L)

- [x] **T5: Shared primitives** — port `Icon`, `StatusDot`, `StatusPill`, `ProjectIcon`, `AgentGlyph`, `Btn`, `TopBar`, `Modal`, `TextField`, `ShimmerBar` from `designs/components.jsx` to TypeScript React components under `src/components/ui/`.
  - Skills: `react-patterns`, `ui-design`
  - Complexity: M
  - Dependencies: T3
  - Status: Done. Plus `Section`, `EmptyState` added.

- [x] **T6: Mission Control view** — port `MissionControl` + `ProjectCard` + `Section` + `EmptyState` from `designs/views.jsx`. Wire up density toggle, search, group/pin sections, dot-grid background. Hook up to live data via TanStack Query (loaders) hitting the projects API.
  - Skills: `react-patterns`, `data-fetching`, `tanstack-start`
  - Complexity: M
  - Dependencies: T5, T8 (projects API)
  - Status: Done. Uses fetch + SSE invalidation rather than TanStack Query (simpler for this app's read patterns).

- [x] **T7: Project Detail view** — port `ProjectView` + `TaskColumn` + `TaskCard` + `ArchiveList`. Wire to tasks API. Live status updates via SSE.
  - Skills: `react-patterns`, `data-fetching`
  - Complexity: M
  - Dependencies: T5, T9
  - Status: Done.

### Stage 3 — Domain APIs (M)

- [x] **T8: Projects + Groups API** — server route handlers for all `/api/projects/*` and `/api/groups/*`. Native folder dialog through Electron IPC (`dialog:browseFolder`). Auto-detect git branch from `.git/HEAD`.
  - Skills: `api-design`, `architecture`, `error-handling`
  - Complexity: M
  - Dependencies: T4
  - Status: Done. Implemented as a Vite middleware (`src/server/api-router.ts` + `src/server/vite-api-plugin.ts`) since current TanStack Start no longer ships file-based API routes.

- [x] **T9: Tasks API + SSE event stream** — `/api/projects/:id/tasks`, `/api/tasks/:id/*`, plus `/api/events` SSE endpoint. In-process event bus broadcasts mutations.
  - Skills: `api-design`, `data-fetching`
  - Complexity: M
  - Dependencies: T4
  - Status: Done.

- [x] **T10: Bearer-token middleware** — generate token on first launch, store in `app_settings`, gate `POST /api/tasks/*`, `POST /api/tasks/:id/status` behind it. Settings page exposes copy-to-clipboard.
  - Skills: `auth-flows`, `frontend-security`
  - Complexity: S
  - Dependencies: T9
  - Status: Done. 32-byte hex token; copy + regenerate on Settings page.

### Stage 4 — Terminals (L) — the hard part

- [x] **T11: PTY manager in main** — `node-pty` wrapper service. IPC channels listed in spec. Per-PTY ring buffer for replay-on-attach.
  - Skills: `architecture`, `error-handling`
  - Complexity: L
  - Dependencies: T2
  - Status: Done. Spawns `$SHELL -l -c "<cmd>; exec $SHELL -l"` so the chosen agent runs atomically inside a login shell with PATH and the user can keep working when it exits. 1MB FIFO ring buffer per PTY for replay-on-attach.

- [x] **T12: xterm.js renderer** — `<TerminalPane>` React component using xterm.js + fit addon. Subscribes to `pty:data` IPC pushes; sends keystrokes via `pty:write`. Resize observer.
  - Skills: `react-patterns`, `performance`
  - Complexity: L
  - Dependencies: T11
  - Status: Done. Dynamic-imports xterm at runtime to avoid CJS-in-SSR break. PTY spawn deferred to `requestAnimationFrame` after first `fit.fit()` so cols/rows match the actual pane size, not xterm defaults.

- [x] **T13: Terminal panel + multi-select** — port `TerminalPanel` from designs but wired to real PTYs. Selecting/unselecting task cards adds/removes panes; max 4. PTYs survive route navigation; pane UI is recreated and replays buffer.
  - Skills: `state-management`, `ux`
  - Complexity: L
  - Dependencies: T12
  - Status: Done. State lifted into a `TerminalProvider` context at root so PTYs survive navigation. 4-pane cap actually `pty.kill()`s the dropped descriptor (no leaks).

### Stage 5 — Agent launching + polish (M)

- [x] **T14: New agent dialog** — port `NewAgentDialog`. On submit: create task → spawn PTY in `project.path` → run `claude` / `codex` / `cursor-agent`. Validate the binary exists on PATH.
  - Skills: `ux`, `forms`, `error-handling`
  - Complexity: M
  - Dependencies: T11, T9
  - Status: Done. PATH validation runs `command -v` (or `where` on Windows) inside the user's login shell via `cli:check` IPC; inline error in the dialog if missing.

- [x] **T15: Add/Edit project + Groups dialogs** — port `ProjectDialog` + `GroupsDialog`. Folder browse via Electron IPC.
  - Skills: `forms`, `ux`
  - Complexity: M
  - Dependencies: T8
  - Status: Done. ProjectDialog now also has a Remove-project (danger) button in edit mode. GroupsDialog supports add / rename / remove.

- [x] **T16: Archive view** — port `ArchiveView`. Wired to `/api/tasks` filtered by `archived=1`. Restore action.
  - Skills: `react-patterns`
  - Complexity: S
  - Dependencies: T9
  - Status: Done.

- [~] **T17: Settings page** — theme toggle, accent color picker (rebroadcast to all CSS variables), API token copy/regenerate.
  - Skills: `ux`, `ui-design`
  - Complexity: S
  - Dependencies: T10
  - Status: API token copy + regenerate done. Theme toggle lives on the top bar.

### Stage 6 — Hardening (M)

- [~] **T18: Tests** — Vitest unit tests for the Drizzle layer + API route handlers. Playwright Electron smoke tests: launch, add a project, open project, start an agent (mock the PTY by using `bash -c "echo hi"`).
  - Skills: `testing`
  - Complexity: M
  - Dependencies: all
  - Status: 4 Vitest unit tests on the projects service pass. Playwright Electron e2e suite not yet written.

- [~] **T19: Packaging** — electron-builder config for macOS (.dmg) and Linux (.AppImage). Code signing left as a TODO (out of v1).
  - Skills: `deployment-sst` (ish — we substitute with electron-builder)
  - Complexity: M
  - Dependencies: all
  - Status: `package.json#build` config + `pnpm package` script wired for mac / linux / win. Production-build path (vite ssr build → in-process server in Electron main) is scaffolded but unverified end-to-end; dev path is the supported path right now.

- [x] **T20: README + skill file for external CLIs** — `README.md` covers install + first-run + API token. Optional: a small markdown skill the user can paste into Claude Code/Codex teaching them how to POST status back.
  - Skills: `docs-agent`
  - Complexity: S
  - Dependencies: all
  - Status: Done. `README.md` covers install / dev / API + endpoints. Skill file at `docs/skills/missioncontrol-notify.md`.

## Success Criteria

- [x] App launches into Mission Control view with seed empty state on first run
- [x] I can add a project from a real folder on disk and it appears as a card
- [x] I can pin/unpin and regroup the project; state persists across restart
- [x] I can click a project, click "New agent", pick Claude Code, and a real `claude` PTY opens in a side panel
- [x] Multi-selecting 3 tasks shows 3 stacked terminals; "Close all" closes them
- [x] An external `curl -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:$PORT/api/tasks/$TASK_ID/status -d '{"status":"done"}'` flips that task to Done in the UI within ~1s
- [~] App matches the prototype design closely in dark and light themes — dark is pixel-close; light theme has one xterm-interior gap
- [ ] `pnpm build && pnpm package` produces a launchable artifact — packaging path scaffolded but not verified end-to-end

## Open Questions

None blocking — these can be decided during build:

1. Random vs fixed port for the local server? Recommendation: random per launch, written to `app.getPath('userData')/.port` so external CLIs can read it.
2. Should `terminal_logs` be opt-in (privacy)? Recommendation: on by default, capped at 1MB per task with FIFO eviction; toggle in Settings.
3. Light theme accent — does the user want a different green for light, or same? Recommendation: same `#7ce58a` works on both per the prototype.
