# Docker Sandbox Runner — Product Plan

Status: **implemented (v1)** — all 5 phases landed; typecheck + full test suite + lint green.
Remaining before ship: a manual click-through of the sandbox paths in the packaged Electron app
(terminal output, file editor, git diff, BYO build) — no headless React/Electron harness exists,
so those renderer→container paths are typecheck + unit verified but not yet runtime-verified in-app.

## Summary

Add an optional **global Docker sandbox runner** to the Electron desktop app. Mission
Control keeps all local persistence (SQLite, projects, tasks, settings). A single
long-lived container — built from a user-supplied or default Dockerfile — runs agent
CLIs (Claude Code, Codex, Cursor agent) and the user's dev stack (Node, Python, etc.).
The container connects to Electron over a local WebSocket; terminals, agent sessions,
**and the repos themselves live inside the sandbox**. There are **no host bind mounts**:
project files are git-cloned into a named Docker volume in the container, and Mission
Control's git diff and file browser read them back over RPC. The UI shell, task state,
and SQLite stay on the host.

This is the desktop equivalent of hosted Daytona runtime, but **bring-your-own-image**
with **bridge networking** so dev servers started inside the container are reachable
from the host browser and from Mission Control launch URLs.

## Goals

- One **global** sandbox shared across all projects (not per-project compose stacks).
- **No host bind mounts** — repos are git-cloned into a named Docker volume inside the
  container; the user configures git and logs in to each agent CLI **inside the sandbox**.
- **Git diff + file browser over RPC** — MC's existing diff/file-browser UI reads the
  in-container repos through `mc-agent`, so the UX matches host mode without mounting.
- **BYO Dockerfile** so users can install Node, Python, databases, or any toolchain
  their repos need.
- **Bridge network** with published ports so `pnpm dev`, `uvicorn`, etc. started in
  the sandbox are accessible at `localhost:<port>` on the host.
- **Connect from Settings** — start/stop container, pair agent, show health.
- **No hosted Postgres** — SQLite and local MC API remain the source of truth.
- Reuse existing hook and status pipeline (`/api/hooks/*`) via
  `host.docker.internal`.

## Non-Goals (v1)

- Remote VM / cloud sandbox (future: same agent protocol, outbound connect mode).
- Per-project Docker Compose stacks.
- Exposing the sandbox workspace as a host folder — the named volume lives in the Docker
  VM; host access to those files is via MC's RPC-backed diff/file browser only.
- Managed image registry or MC-hosted builds.
- Windows Docker Desktop networking edge cases beyond documented workarounds.

---

## Personas

| Persona | Need |
| --- | --- |
| **Local-first developer** | Wants MC UI on macOS but agents + dev servers in Linux container. |
| **Polyglot developer** | Needs Python 3.12 + Node 22 + Postgres client in sandbox; host only has MC. |
| **Isolation-minded developer** | Wants agent CLIs and arbitrary `pnpm dev` isolated from host `$PATH`. |

---

## User Stories

### Epic 1 — Enable the sandbox runner

**US-1.1 — Discover sandbox settings**

> As a desktop user, I open **Settings → Sandbox** so I can configure an optional Docker
> execution environment without leaving Mission Control.

Acceptance:

- New settings section visible only in Electron.
- Shows: Disabled / Stopped / Starting / Connected / Error states.
- Links to prerequisites (Docker Desktop / Docker Engine installed).

**US-1.2 — Use the default sandbox image**

> As a user who just wants agents working in Docker, I click **Use default image** and
> Mission Control builds and starts a container from the bundled reference Dockerfile
> (extends today's `docker/daytona-agent` baseline: agents + git + common tools).

Acceptance:

- One-click build + start for users without a custom Dockerfile.
- Default image includes Claude Code, Codex, Cursor agent, git, bash, curl.
- Build logs stream in settings UI (or open terminal log file).

**US-1.3 — Bring my own Dockerfile**

> As a user with specific runtime needs, I point Mission Control at my own Dockerfile
> (or a directory with `Dockerfile` + optional `docker-compose.yml` override) so the
> sandbox includes my Node/Python versions, system packages, and startup scripts.

Acceptance:

- Settings fields: `Dockerfile path` (file or directory), optional `build context`,
  optional `build args` (key/value), optional `image tag`.
- MC validates the Dockerfile exists before build.
- **Contract:** user's Dockerfile must either:
  - `FROM` the official MC sandbox base image and add layers, or
  - install required agent CLIs + `mc-agent` entrypoint (documented in plan).
- Document minimum requirements: bash, curl, git, writable `/workspace`, non-root user
  recommended, `mc-agent` on `PATH` or as `CMD`.

Example user Dockerfile:

```dockerfile
FROM mission-control/sandbox-base:latest
RUN apt-get update && apt-get install -y python3.12-venv && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
COPY mc-agent /usr/local/bin/mc-agent
CMD ["mc-agent"]
```

**US-1.4 — Start and stop the global sandbox**

> As a user, I click **Start sandbox** to build (if needed) and run one global
> container, and **Stop sandbox** to tear it down without losing my SQLite projects.

Acceptance:

- Exactly one MC-managed sandbox container per MC instance (name prefix
  `mission-control-sandbox`).
- Stop does not delete image layers; start reuses unless user triggers rebuild.
- MC detects Docker not running and shows actionable error.

**US-1.5 — Connect Mission Control to the agent**

> As a user, after the container is running, I click **Connect** so Mission Control
> pairs with the `mc-agent` process and enables sandbox terminals.

Acceptance:

- Pairing uses a one-time token generated in settings (rotates on disconnect).
- Connected state shows: agent version, image tag, uptime, agent CLI versions.
- Disconnect is non-destructive (container keeps running; terminals show disconnected).

---

### Epic 2 — Run agents and terminals in the sandbox

**US-2.1 — Global runtime toggle**

> As a user, I set **Terminal runtime** to `Host` or `Docker sandbox (global)` so all
> new agent sessions use the selected environment.

Acceptance:

- Setting in Settings → Sandbox (default: Host).
- Existing live PTYs on host are unaffected when switching; new spawns use new setting.
- Status badge in terminal panel: `sandbox` vs `local`.

**US-2.2 — Open a task terminal in the sandbox**

> As a user with sandbox connected, I open a task card terminal and the agent starts
> inside the container at the correct project directory.

Acceptance:

- Same UX as local terminal (xterm, resize, replay on reconnect).
- CWD is the project's in-container clone path under `/workspace` (see Path model); no host
  bind mount.
- Spawn policy equivalent: only allow-listed agent commands, no shell injection.
- Hooks fire and update task status (running, finished, needs-input) via
  `host.docker.internal`.

**US-2.3 — Resume and session IDs**

> As a user, I close and reopen a task terminal and the agent resumes the persisted
> session inside the sandbox.

Acceptance:

- Session IDs and hook-driven status behave identically to local Electron runtime.
- Agent auth state (Claude/Codex login) lives in the `mc-agent-config` named volume; the
  user logs in inside the container (no host bind mount).

**US-2.4 — User terminals in sandbox**

> As a user, I open a bare shell terminal (user terminal) and it runs inside the global
> sandbox when runtime is set to Docker.

Acceptance:

- User terminals share the same global container and path mapping rules.

---

### Epic 3 — Bridge networking for dev services

**US-3.1 — Publish ports from the sandbox**

> As a user, I configure which container ports are published to the host so dev servers
> started by agents or launch commands are reachable on `localhost`.

Acceptance:

- Settings: `Published ports` list (e.g. `3000,5173,8000` or range `3000-3010`).
- Compose/run uses bridge network + `-p host:container` mapping (same port both sides
  by default).
- MC validates port conflicts on host before start.
- **Gotcha:** the in-container service MUST bind `0.0.0.0` (or `::`), not `localhost` /
  `127.0.0.1` / `::1`. Docker forwards the published port to the container's `eth0`, so a
  loopback-bound dev server is unreachable from the host even though `docker port` shows
  the mapping. Most dev servers default to loopback: use `vite --host`, `next -H 0.0.0.0`,
  `uvicorn --host 0.0.0.0`, or `HOST=0.0.0.0` for CRA/webpack-dev-server.

**US-3.2 — Launch URL opens host-mapped service**

> As a user, when my agent runs `pnpm dev` on port 3000 inside the container, I click
> the project **Launch** control and MC opens `http://localhost:3000` on the host.

Acceptance:

- Launch URL resolution unchanged (host localhost); bridge publish makes it work.
- Optional future: settings hint when launch fails (port not published).

**US-3.3 — Agent accesses host-only services (optional v1.1)**

> As a user, I can allow the container to reach services on the host (local Postgres,
> MC API) via `host.docker.internal`.

Acceptance:

- Documented default: MC hooks URL =
  `http://host.docker.internal:<mc-port>`.
- Linux: compose `extra_hosts: ["host.docker.internal:host-gateway"]`.
- Optional env passthrough for `DATABASE_URL` pointing at host (advanced, off by default).

**US-3.4 — Container-to-container on bridge (future)**

> As a user running multiple services via compose sidecars, I can attach services to
> the same bridge network (v2; v1 stays single global container).

Note: v1 is **one container** on bridge. Multi-service compose is a follow-up.

---

### Epic 4 — Workspace, files, and path model

**US-4.1 — Clone repos into the sandbox (no bind mounts)**

> As a user, I get my project into the sandbox by cloning it into the container's workspace
> — there are no host bind mounts — so the agent works on an isolated copy.

Acceptance:

- A named Docker volume backs `/workspace`; clones survive stop/start and image rebuilds.
- Each project maps to a stable in-container path `/workspace/<project-slug>` recorded in
  app settings; spawn uses that path as the PTY cwd.
- MC offers an optional **Clone into sandbox** helper (runs `git clone <remote>` into the
  slug path) but the user may also clone manually in a sandbox terminal.
- The user configures git (credentials / SSH / `git config`) **inside the container**; MC
  does not copy host git config in.
- A project needs no host path in sandbox mode (host path optional / ignored).

**US-4.2 — Git diff & file browser over RPC**

> As a user, MC's git diff and file browser show the in-container repo exactly as they do
> for host projects, reading through `mc-agent` instead of the host filesystem.

Acceptance:

- `mc-agent` serves file list/read/write/watch and git status/diff for paths under
  `/workspace` (mirrors `electron/file-handlers.ts` + `src/server/services/git.ts`).
- `GitDiffView` and the file browser/editor route to RPC when the project's runtime is the
  sandbox; behavior (changed-files list, per-file diff, live file watch) matches host mode.
- RPC refuses any path outside the `/workspace` prefix.

**US-4.3 — Log in to each agent inside the sandbox**

> As a user, I log in to Claude/Codex/Cursor once inside the sandbox and stay logged in
> across container restarts and rebuilds — separate from my host agent logins.

Acceptance:

- Agent config dirs (`~/.claude`, `~/.codex`, etc.) persist in a named volume, not a host
  bind mount.
- Each agent CLI is authenticated **inside the container** (no host credential sync).
- Document the separation from host agent credentials.

---

### Epic 5 — Operations and safety

**US-5.1 — Health and diagnostics**

> As a user, I see whether Docker, the container, and the agent are healthy, with copyable
> logs when something fails.

Acceptance:

- States: Docker daemon, image built, container running, agent WS connected, CLIs on PATH.
- **Copy diagnostics** bundles versions, last 50 log lines, mount config (no secrets).

**US-5.2 — Fail closed to host**

> As a user, if the sandbox disconnects mid-session, MC shows a clear error and does not
> silently fall back to host execution for that task.

Acceptance:

- Explicit reconnect or "Continue on host" action (creates new session; no silent mix).

**US-5.3 — Resource limits (optional v1.1)**

> As a user, I can set CPU/memory limits on the global container in settings.

---

## Architecture

```
┌──────────────────────── Electron (host) ────────────────────────────┐
│  SQLite · projects/tasks · MC API @ 127.0.0.1:<port>               │
│  git diff + file browser UI  (RPC-backed in sandbox mode)          │
│  Settings → docker compose lifecycle · WS client → mc-agent        │
└───────────────▲───────────────────────────────▲─────────────────────┘
                │ HTTP hooks                     │ WS: PTY · control ·
                │ host.docker.internal           │      file/git RPC
┌───────────────┴────────────────────────────────┴─────────────────────┐
│  Global container (bridge network)                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  mc-agent: WS server, PTY, file/git RPC, hook install, health│   │
│  │  claude · codex · cursor-agent · user Node/Python stack     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  Published: 3000, 5173, 8000 → host localhost                     │
│  Named volume: /workspace  (in-container git clones, no bind mount)│
│  Named volume: agent auth/config (~/.claude, ~/.codex)            │
└─────────────────────────────────────────────────────────────────────┘
```

### Runtime modes (desktop)

| Mode | PTY | Persistence | Hooks target |
| --- | --- | --- | --- |
| **Host** (today) | `electron/pty-manager` | SQLite | `127.0.0.1` |
| **Docker sandbox** (new) | `mc-agent` over WS | SQLite | `host.docker.internal` |

Hosted web / Daytona unchanged.

---

## `mc-agent` responsibilities

Small Node binary or script shipped in the default image; users add it to BYO images.

| Responsibility | Notes |
| --- | --- |
| **WebSocket server** | Listen on `0.0.0.0:${MC_AGENT_PORT}` (default `9333`); Electron connects as client. |
| **Pairing** | Reject connections without valid one-time token from settings. |
| **PTY lifecycle** | spawn / write / resize / kill; seq-numbered output + ring buffer replay. |
| **File RPC** | list / read / write / watch under `/workspace` (mirror `electron/file-handlers.ts`) for the file browser + editor. |
| **Git RPC** | status / changed files / per-file diff under `/workspace` (mirror `src/server/services/git.ts`) for `GitDiffView`. |
| **Clone helper** | optional `git clone <remote>` into `/workspace/<slug>` (US-4.1). |
| **Hook bootstrap** | Port `electron/agent-hooks.ts` behavior at spawn; set `MC_*` env. |
| **Health** | `GET /health` HTTP alongside WS (or WS ping). Report CLI `--version` results. |
| **Workspace guard** | Refuse any PTY cwd, file, or git path outside the `/workspace` prefix. |

Not in v1 agent scope: SQLite, project/task CRUD (those stay host-side). File and git RPC
**are** in scope (the read/diff surface for the file browser + `GitDiffView`, plus the clone helper).

### WebSocket protocol (sketch)

```typescript
// Electron → agent — PTY
{ type: "spawn", ptyId, taskId, cwd, command, agent, cols, rows, mcEnv }
{ type: "write", ptyId, data }
{ type: "resize", ptyId, cols, rows }
{ type: "kill", ptyId }

// Electron → agent — file/git RPC (correlated by reqId)
{ type: "rpc", reqId, method: "fs.list",    params: { dir } }
{ type: "rpc", reqId, method: "fs.read",    params: { path } }
{ type: "rpc", reqId, method: "fs.write",   params: { path, contents } }
{ type: "rpc", reqId, method: "fs.watch",   params: { path } }   // streams fs.change events
{ type: "rpc", reqId, method: "git.status", params: { repo } }
{ type: "rpc", reqId, method: "git.diff",   params: { repo, file? } }
{ type: "rpc", reqId, method: "git.clone",  params: { remote, slug } }

// Agent → Electron
{ type: "ready", version, agents: { claude, codex, cursor } }
{ type: "output", ptyId, seq, data }
{ type: "exit", ptyId, exitCode?, error? }
{ type: "rpcResult", reqId, ok: true, result }
{ type: "rpcResult", reqId, ok: false, error }
{ type: "fs.change", path, kind }   // for active fs.watch subscriptions
```

---

## BYO Dockerfile contract

Users may extend or replace the base image. MC documents a **compatibility checklist**:

1. **Required binaries:** `bash`, `curl`, `git`, agent CLIs the user plans to run.
2. **Required process:** `mc-agent` as `CMD` or `ENTRYPOINT` (MC provides source/bin).
3. **Required directory:** writable `/workspace` (match `WORKDIR`); MC mounts a named volume
   here for git clones — the image must not bake project files into it.
4. **Recommended user:** non-root `workspace` user with passwordless sudo optional.
5. **Networking:** expect bridge + published ports from MC compose template (user Dockerfile
   does not define `network_mode: host`).
6. **Optional:** `EXPOSE` documentation for common dev ports (informational only).
7. **Auth / git:** do not bake credentials. Users run `git config` and each agent's `login`
   inside the running container; both persist via MC's named volumes.

MC-generated compose (not user-edited for v1) wraps the user image:

```yaml
services:
  mc-sandbox:
    build:
      context: ${MC_SANDBOX_BUILD_CONTEXT}
      dockerfile: ${MC_SANDBOX_DOCKERFILE}
    container_name: mission-control-sandbox
    networks: [mc-bridge]
    ports:
      - "${MC_AGENT_PORT:-9333}:9333"
      # user-published dev ports appended here
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - mc-workspace:/workspace
      - mc-agent-config:/home/workspace/.config
    environment:
      MC_AGENT_PORT: "9333"
      MC_HOOK_API_HOST: host.docker.internal
    restart: unless-stopped

volumes:
  mc-workspace:        # in-container git clones (no host bind mount)
  mc-agent-config:     # agent auth/config (~/.claude, ~/.codex)

networks:
  mc-bridge:
    driver: bridge
```

---

## Settings model (SQLite `app_settings`)

| Key | Purpose |
| --- | --- |
| `sandbox.enabled` | Master toggle for Docker runtime option |
| `sandbox.runtimeMode` | `host` \| `docker` |
| `sandbox.dockerfilePath` | User Dockerfile or build context dir |
| `sandbox.buildArgs` | JSON map of build args |
| `sandbox.imageTag` | Local tag after build |
| `sandbox.publishedPorts` | CSV or JSON list of host/container ports |
| `sandbox.workspaceVolume` | Named Docker volume backing `/workspace` (default `mc-workspace`) |
| `sandbox.projectPaths` | JSON map of project id → in-container clone path (`/workspace/<slug>`) |
| `sandbox.agentPort` | WS port (default 9333) |
| `sandbox.pairingToken` | Rotating secret for WS auth |
| `sandbox.agentConfigVolume` | Named volume for agent credentials (default `mc-agent-config`) |

No change to `projects` / `tasks` tables for v1; the project → container-clone-path map lives
in `sandbox.projectPaths`, resolved at spawn and for file/git RPC.

---

## Implementation phases

Conventions every task below follows (don't re-derive these per task):

- **IPC**: add the channel name to `electron/ipc-channels.ts`, register the handler with
  `safeHandle(...)` from `electron/ipc-safe-handle.ts` in `electron/main.ts`, and expose it
  on the renderer via `contextBridge` in `electron/preload.ts`. The renderer namespace is
  `window.electronAPI` (not `electron`).
- **Settings**: persist via `electron/app-settings-store.ts` (main process) using the
  `sandbox.*` keys in the [Settings model](#settings-model-sqlite-app_settings) table.
- **Mirror, don't fork**: the remote PTY surface must match the local PTY API in
  `electron/pty-manager.ts` so terminal components stay runtime-agnostic. Reference remote
  protocol: `src/server/services/daytona-remote-pty.ts`.

Legend: each `[ ]` is a single sittable task. **Done when** lines are the verification gate
that closes the group — don't move on until it passes.

### Phase 1 — `mc-agent` + default image (1–2 weeks) — ✅ COMPLETE

Goal: a container you can `docker run` and drive a PTY over WebSocket, with hooks firing back
to the host. No Electron UI yet.

Hook extraction
- [x] Catalog host-only assumptions in `electron/agent-hooks.ts` and `electron/pty-hook-env.ts`
  (hard-coded paths, `127.0.0.1` hook host).
- [x] Extract hook-install + `MC_*` env construction into a shared module importable by both
  Electron and `mc-agent`; parameterize the hook host (`127.0.0.1` vs `host.docker.internal`).
  → `src/shared/agent-hooks.ts` + `src/shared/mission-control-hook-env.ts`
  (`buildMissionControlApiUrl(host, port)`); electron paths kept as re-export shims.
- [x] Unit-test the extracted env builder for both host targets.
  → `src/shared/__tests__/mission-control-hook-env.test.ts`

`mc-agent` binary (`mc-agent/`)
- [x] Scaffold `mc-agent` (Node) with a WS server on `0.0.0.0:${MC_AGENT_PORT:-9333}`.
  → `mc-agent/src/server.ts` + `index.ts` (pairing via `Authorization: Bearer`;
  **fails closed** if no token unless `MC_AGENT_INSECURE=1`).
- [x] Implement spawn/write/resize/kill per the [WS protocol sketch](#websocket-protocol-sketch);
  reuse `node-pty` as in `electron/pty-manager.ts`. → `mc-agent/src/pty-host.ts`, `protocol.ts`
- [x] Seq-numbered output + ring-buffer replay on reconnect (mirror the buffering in
  `electron/pty-manager.ts`; `nextSeq` semantics matched for reconnect parity).
- [x] Port the spawn allow-list from `electron/pty-spawn-policy.ts` (reused, not duplicated —
  relocated to `src/shared/pty-spawn-policy.ts` with injected `/workspace` root).
- [x] Workspace guard: refuse any spawn `cwd` outside the `/workspace` prefix.
  → `mc-agent/src/workspace-guard.ts`
- [x] `GET /health` + agent CLI `--version` probe (claude/codex/cursor) for the `ready` payload.
  → `mc-agent/src/health.ts`
- [x] Bootstrap hooks at spawn via the shared module, targeting `host.docker.internal`.

File / git RPC (powers the sandbox diff + file browser)
- [x] `fs.list` / `fs.read` / `fs.write` / `fs.watch` under `/workspace` mirroring
  `electron/file-handlers.ts`; stream `fs.change` events for active watches. → `mc-agent/src/file-rpc.ts`
- [x] `git.status` / `git.diff` (changed files + per-file) under `/workspace` reusing the shared
  parser/classifier (extracted to `src/shared/git-status.ts`; `git.ts` now imports it).
  → `mc-agent/src/git-rpc.ts`
- [x] `git.clone` helper into `/workspace/<slug>` (US-4.1) — HTTP(S) plus GitHub SSH
  (`ext::`/`file://` and non-GitHub SSH blocked), in-flight slug lock, minimal git env.
- [x] Extend the workspace guard to reject any RPC path outside `/workspace`.

Default image
- [x] Author `docker/sandbox-base/Dockerfile` extending the `docker/daytona-agent/Dockerfile`
  baseline (claude, codex, cursor-agent, git, bash, curl) + `mc-agent` as `CMD`.
- [x] Build locally; confirm CLIs + `mc-agent` on `PATH`, `/workspace` writable, non-root
  `workspace` user. → `pnpm build:mc-agent` (esbuild bundle, node-pty external) +
  `docker build -f docker/sandbox-base/Dockerfile -t mission-control/sandbox-base mc-agent`.

**Done when:** ✅ verified via an end-to-end smoke test (Node WS client against the bundled
agent): health, pairing rejection, `Authorization: Bearer` auth, real PTY spawn+echo, file RPC
write/read, workspace-guard escape block, and `git.clone` transport guard all pass.
Full repo gate green: typecheck + 799 tests + 0 lint errors. ~70 new unit tests added.

**Phase 1 review notes (gated reviews run on the diff):**

- Contracts review: **0 findings** — all re-export shims + the `git-status` extraction resolve
  for every existing consumer.
- Security/concurrency findings fixed in this phase: git-clone transport allow-list + minimal
  git env; fail-closed pairing; token via header (not just query); `GIT_LITERAL_PATHSPECS`;
  `spawned`-before-output ordering; clone-slug TOCTOU lock; `nextSeq` host parity; probe
  `.catch`; structured stdout logging on ws/spawn/rpc/clone/hook boundaries.
- **Carried to Phase 2** (must-do): the MC-generated compose **must set `MC_PAIRING_TOKEN`** in
  the container `environment:` (the agent now refuses to start without it). Wire
  `sandbox.pairingToken` → compose env when generating the stack.
- Deferred (documented): per-connection rate limits on clone/watch/spawn → US-5.3 (v1.1);
  base-image digest pinning + agent-CLI version pinning → Phase 4/5 hardening; `fs.read`/`list`
  have no sensitive-path deny-list (parity with host file browser — same user/trust model);
  `fs.write` optimistic-lock is best-effort (host parity).

### Phase 2 — Electron lifecycle + settings UI (1–2 weeks) · US-1.1–1.5, US-5.1 — ✅ COMPLETE

Settings persistence
- [x] Add the `sandbox.*` keys (Settings model table) to `electron/app-settings-store.ts` with
  typed getters/setters. → `setAppSetting`/`deleteAppSetting` added; typed accessors in
  `electron/sandbox-settings.ts` (`readSandboxSettings`/`writeSandboxSettings`, DI-tested,
  build-arg keys + volume names validated against compose injection).
- [x] Pairing token: generate + persist `sandbox.pairingToken` (`ensurePairingToken`), rotate
  (`rotatePairingToken`, fired after a successful teardown).

Compose lifecycle (main process) → `electron/sandbox-manager.ts` + `electron/sandbox-compose.ts`
- [x] Render the [MC-generated compose](#byo-dockerfile-contract) from settings (agent port,
  named volumes, `extra_hosts`, **`MC_PAIRING_TOKEN` injected** per the Phase 1 carry-forward) —
  no host bind mounts. File written 0600 (token is plaintext in it).
- [x] IPC `sandbox.up` / `sandbox.down` / `sandbox.status` → `docker compose up -d` / `down`,
  `docker info` for daemon detection. Start/stop serialized (op-epoch + in-flight guard).
- [x] Detect Docker-not-running and surface an actionable error (US-1.4).
- [x] Stream build logs to the renderer (`sandbox.log`) + persist to electron-log (token-redacted).

WS client (main process)
- [x] WS client connects to `mc-agent` with `Authorization: Bearer` + reconnect with backoff
  (epoch-guarded against stale reconnects; orphan-socket safe).
- [x] Surface the `ready` payload (agent version, CLI versions) → `connected` state.

Settings UI (Electron-only) → `src/components/views/SandboxSettingsPage.tsx`
- [x] Settings → Sandbox section with state machine Disabled / Stopped / Starting / Running /
  Connected / Error (US-1.1); Electron-gated nav entry in `SettingsPanel.tsx`.
- [x] Use-default-image vs BYO-Dockerfile field; validate the Dockerfile path exists (US-1.2/1.3).
- [x] Start / Stop / Connect / Disconnect controls (US-1.4/1.5), disabled-while-busy + aria-busy.
- [x] Diagnostics panel + Copy diagnostics (versions, last 50 log lines, mount config — token +
  build-arg values excluded) (US-5.1).

**Done when:** ✅ logic verified — full repo gate green (typecheck + 823 tests + 0 lint errors);
compose rendering + settings validation + pairing-token lifecycle covered by 24 unit tests
including compose-injection regressions. (Live click-through of Start→Connect→Stop in the
packaged Electron app is the remaining manual QA step — the underlying agent + compose are
already smoke-verified end to end in Phase 1.)

**Phase 2 review notes (gated reviews):**
- Contracts: **0 findings** — the 3-tier IPC surface (manager ↔ preload/ipc-channels ↔
  electron-contract/renderer) is identical; pairing token absent from all renderer shapes.
- Security fixes: 🔴 compose-YAML injection via build-arg **keys** (→ `privileged: true`/host
  escape) and 🟠 via **volume names** (→ host bind mount) — both now validated at the settings
  boundary AND re-guarded at the compose sink; compose file written 0600.
- Concurrency fixes: start/stop reentrancy guard; late-`ready` ignored after stop; token rotated
  after (not before) teardown; epoch-guarded reconnect + orphan-socket teardown; backoff no
  longer reset on every attempt.
- Observability: compose output + failures (exit code + stderr tail) + ws lifecycle persisted to
  electron-log, token-redacted.
- Deferred: `validateDockerfile` path-existence oracle (behind `safeHandle`, trusted renderer);
  Save-button success toast; per-op metrics (no metrics lib).

### Phase 3 — Terminal + workspace RPC integration (1.5–2 weeks) · US-2.1–2.4, US-4.1–4.2 — ✅ COMPLETE

**Foundation landed (main-process bridge complete):**
- `electron/sandbox-agent-client.ts` — the reusable WS request/subscription layer
  (`SandboxAgentClient`: promise `rpc()` with reqId⇄rpcResult correlation + timeout, PTY control
  frames, output/exit/ready/fs.change streams). 9 unit tests; `sandbox-manager` drives its
  connection through it.
- **IPC bridge wired** main↔preload↔contract: `electronAPI.remotePty.*` (spawn/write/resize/kill/
  replay + onData/onExit/onSpawned/onSpawnError), `electronAPI.remoteFs.*` (list/read/write/watch/
  unwatch + onChange), `electronAPI.remoteGit.*` (status/diff/clone). `mcEnv` (MC API port+token)
  is injected server-side for remote hooks; replay is correlated by ptyId.

**Path model + TerminalPane routing landed:**
- `src/shared/hosted-workspace.ts` — `workspaceSlug()` extracted; `sandboxWorkspacePath(name)` →
  `/workspace/<slug>` (US-4.1 path model). 4 unit tests.
- `TerminalPane` routes to `electronAPI.remotePty` vs `electronAPI.pty` via `descriptor.runtime`
  (defaults `"host"` → identical local behavior; sandbox path dormant until the parent activates
  it). `onExit` shape aligned across pty/remotePty for a clean union. Typecheck + full suite green.
  ⚠ The remote terminal path is typecheck-verified only — needs manual QA in the packaged app
  (no headless React/Electron harness).

**Terminal routing active (both panes):** `TerminalPane` (agent) + `UserTerminalPane` (user shell)
read `runtimeMode` fresh at terminal start and route to `electronAPI.remotePty` (container cwd =
`sandboxWorkspacePath(...)`) vs the local PTY — self-contained, no parent/store changes, host
path provably identical (US-2.1–2.4). ⚠ Remote path typecheck-verified only (manual QA in app).

**File browser + editor routed (US-4.2 file side):** `src/lib/project-fs.ts` adapter routes
`(projectRoot, relPath)` → host `files` or `remoteFs` (container clone) by runtime, encapsulating
path translation + the watch/onChange shape difference. `FileFinderDialog` (list) +
`FileEditorDialog` (read/write/watch) both use it; default-preserved. 6 unit tests on the routing.

**Git diff routed (US-4.2 git side):** `src/lib/project-git.ts` adapter routes `git.status`/
`git.diff` reads → host HTTP API or `remoteGit` RPC by runtime (opted in via an optional
`sandboxRepoPath` on the shared query options — default-preserved for `CommitPushButton` et al.).
`GitDiffView` passes the container repo path. 5 routing tests. (Stage/commit/push stay HTTP —
the agent only exposes status/diff/clone; in-sandbox commits happen via the terminal.)

**Clone action + status badge:** SandboxSettingsPage has a "Clone a repo into the sandbox" form
(`remoteGit.clone`, slug derived from the URL, enabled only when connected); `TerminalPane` shows
a "sandbox" badge when the terminal runs in the container.

**Done when:** ✅ all routing logic landed; full repo gate green (typecheck + 847 tests + 0 lint
errors); WS client / fs / git routing covered by 20 unit tests (sandbox-agent-client 9, project-fs
6, project-git 5) + path-model 4. ⚠ The renderer→remote paths (terminal output, file editor, git
diff in the container) are typecheck + unit verified but need a manual click-through in the
packaged app — no headless React/Electron harness exists.

**Phase 3 review notes (gated reviews):**
- Security: **0 findings** — the host-side bridge is a pass-through to the agent, which already
  enforces /workspace confinement, the spawn allow-list, and the git transport allow-list (Phase
  1). `mcEnv` (port+token) is injected server-side, never from the renderer; no token leaks.
- Contracts: the remote* IPC chain (manager ↔ ipc-channels/preload ↔ electron-contract ↔
  adapters/components) is consistent; the `pty | remotePty` union only uses aligned shared methods.
  Deferred (low): `onExit` coerces a signal-kill's missing code to 0 (matches local pty's
  number-typed shape); `remoteFs.read` mimeType widening (runtime always agrees — keep the two mime
  lists in sync).
- Concurrency fixes: stale-client guard extended to all stream forwarders (`isLiveClient`); replay
  correlation settles a prior same-ptyId entry before overwriting; ptyId now `randomUUID()`.

**Manual-QA fixes (found running the packaged app):**
- Sandbox terminals silently did nothing for an **un-cloned** project: spawn at `/workspace/<slug>`
  failed the agent's cwd check (`invalid-cwd`) and the `spawnError` was never surfaced. Fixed:
  (a) the agent `mkdir -p`s the workspace cwd before spawn (`PtyHost.ensureWorkspaceCwd`) so a fresh
  project opens a terminal at its slot; (b) `TerminalPane` + `UserTerminalPane` now subscribe
  `remotePty.onSpawnError` and print the failure instead of hanging blank. Regression-tested
  (pty-host) + end-to-end smoke (spawn into a missing dir → auto-created, opens).
- The "sandbox" terminal badge overlapped the pane buttons → moved to bottom-left, dimmed.
- (Known, benign) the first WS connect right after `compose up` can `ECONNRESET` because the
  in-container agent isn't bound yet; the backoff reconnect (~1s) succeeds. Self-heals.

Project path model
- [x] Resolve each project to its in-container clone path `/workspace/<slug>` via
  `sandboxContainerRoot()` / `sandboxWorkspacePath()`; used as PTY cwd and as the root for file/git RPC.
- [x] "Clone into sandbox" action → `remoteGit.clone` into the slug path (US-4.1) — see v1.1
  clone-on-open below (replaces the static per-project mapping; detected on open).

Terminal
- [x] Define `remotePty` IPC channels in `electron/ipc-channels.ts` mirroring the local PTY API;
  expose on `window.electronAPI.remotePty.*` in `electron/preload.ts`.
- [x] Bridge `remotePty` IPC ↔ the Phase 2 WS client in `electron/sandbox-manager.ts`
  (spawn/write/resize/kill/onData/onExit/onSpawned/onSpawnError).
- [x] Route `src/components/views/TerminalPane.tsx` + `UserTerminalPane.tsx` to local vs remote
  PTY based on `sandbox.runtimeMode`; `TerminalPanel.tsx` / `UserTerminalPanel.tsx` stay
  runtime-agnostic (US-2.1, US-2.4).
- [x] `sandbox` vs `local` status badge in the terminal panel (US-2.1) — bottom-left, dimmed.
- [x] Point hook env at `host.docker.internal` for remote spawns (agent bootstraps hooks at spawn).
- [x] Session-resume parity: reopen a task terminal → seq-numbered ring-buffer replay resumes the
  in-container session (US-2.3).

File / git RPC routing (host UI)
- [x] Add a `remoteFs` / `remoteGit` IPC surface bridging to the WS file/git RPC (mirrors the
  shape of `window.electronAPI.files.*`).
- [x] Route the file browser + `FileEditorDialog` / `FileFinderDialog` to RPC via the
  `src/lib/project-fs.ts` adapter when the project's runtime is the sandbox (US-4.2).
- [x] Route `src/components/views/GitDiffView/*` (changed-files list, per-file diff) to the
  `remoteGit.*` RPC via `sandboxContainerRoot()` (US-4.2).
- [x] Wire `fs.change` events → live refresh through `project-fs`'s `onChanged` adapter.

**Done when:** with runtime=Docker, a cloned project opens a terminal in its `/workspace/<slug>`
dir, and the git diff + file browser show in-container changes live — identical to host mode.

### Phase 4 — BYO Dockerfile + bridge ports (1 week) · US-1.3, US-3.1–3.3 — ✅ COMPLETE

Most of this landed in Phase 2's compose layer (`electron/sandbox-compose.ts`, tested):

- [x] Build from `sandbox.dockerfilePath` (file or dir) with optional build context, build args,
  and image tag (US-1.3). → `renderComposeFile` emits a `build:` block (context = dir or
  dirname(file), `dockerfile:`, `args:`) when a Dockerfile path is set; `sandbox-manager`'s
  `up` adds `--build`. Settings UI has the BYO Dockerfile field + Validate. Tested.
- [x] Published-ports editor (`3000,5173` or range `3000-3010`). → `parsePublishedPorts` + the
  Published-ports field in `SandboxSettingsPage`. Host port conflicts surface as Docker's own
  "port is already allocated" error at `up`, which the manager captures + shows (a deliberate
  choice over a bind-based pre-check, which would false-block an idempotent restart).
- [x] Append published ports to the compose template (same port both sides). → `renderComposeFile`
  (skips a duplicate of the agent port). Tested.
- [x] Linux `extra_hosts: ["host.docker.internal:host-gateway"]`. → in every generated compose.
- [ ] Verify Launch URL resolves to `localhost:<port>` against an in-container `pnpm dev` (US-3.2)
  — no code needed (Launch opens host `localhost`; the published port makes it reachable); this is
  a manual-QA step in the packaged app.

**Done when:** ✅ build/ports/extra_hosts implemented + unit-tested; the Node 22 + Python 3.12 BYO
flow + `pnpm dev`→`localhost:3000` round-trip is the manual-QA confirmation.

### Phase 5 — Polish (3–5 days) · US-4.3, US-5.2 — ✅ COMPLETE

- [x] Agent-credential **named volume** for `~/.claude`, `~/.codex` (via `sandbox.agentConfigVolume`,
  default `mc-agent-config`); mounted at `/home/workspace/.config` in every generated compose; user
  logs in to each agent inside the container; persists across restart + rebuild (US-4.3).
- [x] Disconnect mid-session → clear state, no silent host fallback (US-5.2). The WS client
  auto-reconnects with backoff; `connected → running` on drop; Settings shows the live state +
  Connect/Disconnect. A sandbox terminal whose agent drops surfaces the error (never silently
  re-spawns on host — runtime is the explicit Terminal-runtime setting). _Per-terminal "Continue on
  host" button: deferred polish; the no-silent-fallback property already holds._
- [x] Docs: see **Setup & usage** below — prerequisites, default vs BYO image, in-container git +
  per-agent login, Apple Silicon, troubleshooting. (`mc-agent/README.md` documents the agent.)

**Done when:** ✅ credential volume + reconnect/error handling implemented; killing the container
shows a disconnected state and restarting keeps the agent logged in (manual-QA confirmation).

### Cross-phase dependencies

- The Phase 2 WS client depends on the Phase 1 protocol (PTY **and** file/git RPC) being
  **frozen** first.
- Phase 3's project→clone-path map (`sandbox.projectPaths`) and file/git RPC routing depend on
  the Phase 1 RPC surface plus the Phase 2 WS client.
- Resolve [Open questions](#open-questions) #5 (compose vs `docker run`) **before** Phase 2;
  #1 (project ↔ clone mapping) **before** Phase 3; #2 (rebuild policy) **before** Phase 4.

**Estimated total:** 4–6 weeks.

---

## Open questions

1. **Project ↔ clone mapping** — derive `/workspace/<slug>` from project name/id, or store an
   explicit remote URL per project to drive the clone helper?
2. **Rebuild policy** — rebuild on Dockerfile mtime change, or manual "Rebuild image" only?
   (The named `mc-workspace` volume persists clones across rebuilds regardless.)
3. **Decided:** agent auth is **container-only** — users log in to each CLI inside the sandbox;
   no host credential sync. Persisted in the `mc-agent-config` named volume.
4. **Apple Silicon / Rosetta** — document platform in build settings (`linux/amd64` vs `arm64`).
5. **Compose vs plain `docker run`** — compose preferred for bridge + ports + named volumes.
6. **RPC diff perf** — for large repos over WS, paginate `git.status` / `fs.list` or stream
   per-file diffs rather than sending whole trees at once?

---

## Success criteria

- User with custom Node 22 + Python 3.12 Dockerfile clones a repo into the sandbox, runs
  agents and `pnpm dev` in one global container, and opens the app at the published localhost
  port from the MC launch URL.
- Git diff + file browser show in-container changes over RPC, matching host-mode UX.
- Task status, session resume, and permission prompts match local Electron behavior.
- No host bind mounts; clones + agent logins persist in named volumes across restart/rebuild.
- SQLite projects unchanged; no `DATABASE_URL` required.
- Disconnect sandbox → clear UI state; reconnect without data loss.

---

## Setup & usage

**Prerequisites**
- Docker Desktop (macOS/Windows) or Docker Engine (Linux) running.
- The default sandbox image, or a BYO Dockerfile. Build the default image once:
  ```sh
  pnpm build:mc-agent   # bundles mc-agent → mc-agent/dist/mc-agent.cjs
  docker build -f docker/sandbox-base/Dockerfile -t mission-control/sandbox-base:latest mc-agent
  ```

**Enable & start (Settings → Sandbox, desktop app only)**
1. Toggle **Enable Docker sandbox**.
2. Set **Terminal runtime** to **Docker sandbox (global)** — new terminals (and the git diff +
   file browser for the open project) then operate in the container.
3. Optionally set **Published ports** (e.g. `3000,5173` or `3000-3010`) and a **Custom Dockerfile**
   (blank = bundled default image).
4. **Start sandbox** → it renders a compose file (with a freshly generated pairing token),
   `docker compose up -d`, and connects. The badge shows Disabled / Stopped / Starting / Running /
   Connected / Error; build/compose logs stream live.

**Get a repo into the sandbox** (no host bind mounts — repos are cloned into the `mc-workspace`
named volume)
- **Clone a repo into the sandbox** form (HTTP(S) URLs or GitHub SSH remotes), or
- open a sandbox terminal and `git clone <url>` yourself for other transports.
- A project maps to `/workspace/<slug>` (slug derived from the project/dir name).

**Configure git + agent logins (once, inside the container)** — these are separate from your host
setup and persist in the `mc-agent-config` named volume across restart + rebuild:
- `git config --global user.email …` / `user.name …` (and SSH keys if cloning via SSH).
- Run each agent's login in a sandbox terminal: `claude` (login), `codex` (login), `cursor-agent`.

**Apple Silicon / platform** — the default image follows the host arch. For an x86-only toolchain,
add `platform: linux/amd64` to your BYO Dockerfile (runs under Rosetta) or pin the base accordingly.

**Troubleshooting**
- _"Docker isn't running"_ — start Docker, then **Start sandbox** again.
- _Port already allocated_ — Docker reports it at start (shown in the logs); free the host port or
  change **Published ports**.
- _Stuck "Running · connecting…"_ — the container is up but the agent hasn't paired; check the
  logs, or **Stop** then **Start** (which rotates the pairing token).
- _Hooks/status not updating in the container_ — the agent posts to `host.docker.internal`; on
  Linux this needs the `extra_hosts: host-gateway` mapping (already in the generated compose).
- Use **Copy diagnostics** for a secret-free bundle (state, versions, ports, last 50 log lines).

---

## Revised onboarding model (v1.1 — from in-app testing)

**Problem found in v1:** toggling to Docker runtime kept the existing project list, but those repos
aren't in the container, so opening a terminal spawned at a non-existent `/workspace/<slug>`
(`invalid-cwd`). The v1 stop-gap (`mkdir -p` the slot) opens an *empty* dir — not the repo.

**Decided (user):**
1. **Reuse the existing project list; clone on open.** When sandbox runtime is active and a project
   is opened, MC detects the project's git remote on the host (`git -C <path> remote get-url
   origin`) and, if `/workspace/<slug>` isn't a git repo yet, offers **Clone into sandbox**
   (remote pre-filled, manual-URL fallback for local-only repos) → `remoteGit.clone`. The
   `mkdir` fallback stays only so a terminal still opens when there's no remote.
2. **Git auth = user choice** (`sandbox.gitAuthMode`): **copy host `~/.ssh`** into the VM at
   start, or **generate an ed25519 key in the VM** and show the public key to add to GitHub.
   Keys persist in a new `mc-agent-ssh` named volume (`/home/workspace/.ssh`).

**Implementation checklist:**
- [x] Agent: `ssh.setup` RPC (`mc-agent/src/ssh-rpc.ts`) — `generate` (ssh-keygen ed25519 +
      ssh-keyscan github.com → known_hosts, return pubkey) / `copy` (write provided key files at
      0600, pub/known_hosts/config at 0644, unsafe filenames rejected). Added `mc-agent-ssh` named
      volume (`/home/workspace/.ssh`) to the generated compose. Unit-tested (perms + idempotency).
- [x] Setting `sandbox.gitAuthMode` (`none`|`copy-host`|`generate`); manager provisions on connect
      (`provisionGitAuth`): copy-host reads host `~/.ssh` (safe names, <64KB) → `ssh.setup` copy;
      generate calls the agent → surfaces pubkey. `onReady` auto-provisions after connect.
- [x] Host remote detection IPC (`sandbox.detectRemote(projectPath)` → `git -C <path> remote get-url
      origin`), bridged through preload + `ElectronBridge.sandbox.detectRemote`.
- [x] Clone-on-open UX: `TerminalPane` checks `remoteGit.status(sandboxCwd)`; on failure +
      detected remote it shows a **Clone into sandbox** banner → `remoteGit.clone` → bumps the
      retry nonce so the effect re-runs and the agent spawns. `mkdir` fallback stays for no-remote.
- [x] Settings UI: Git-auth picker (None / Copy my ~/.ssh / Generate a key) + "Set up" button
      (enabled when connected) + copyable generated-pubkey display (`SandboxSettingsPage.tsx`).

**Security hardening (from the v1.1 review pass):**
- [x] Compose publishes every port on `127.0.0.1` (loopback), never `0.0.0.0` — the token-gated
      agent WS and dev-server ports are no longer LAN-reachable (`sandbox-compose.ts`). Launch URLs
      still resolve to `localhost:<port>`.
- [x] `git clone` failures scrub embedded credentials from git's stderr before the message reaches
      the renderer (`scrubCloneError` in `git-rpc.ts`); `GIT_TERMINAL_PROMPT=0` so a bad credential
      fails fast instead of blocking the RPC on an invisible prompt.
- [x] GitHub's host key is **pinned** (published ed25519) instead of trust-on-first-use
      `ssh-keyscan`, which a MITM could poison (`ssh-rpc.ts`).
- [x] Unauthenticated `GET /health` returns `{ ok, version }` only — no `workspaceRoot`
      (`server.ts`). `AGENT_VERSION` bumped to `0.2.0` so a stale in-container bundle is detectable.
- Contract review: all four IPC/RPC layers (agent protocol → WS client → preload → renderer
      contract) verified consistent end-to-end — no drift.

**Volume-ownership fix (from in-app testing — `ssh.setup` EACCES + terminals hung):**
- Root cause: Docker creates named-volume mount points (`~/.ssh`, `~/.config`) as `root:root`, but
      `mc-agent` runs as the unprivileged `workspace` user — so `ssh.setup` (and any agent-CLI
      config write) failed with `EACCES`, and agent sessions stalled on startup. (`/workspace` was
      already correct because the image pre-creates it.)
- [x] Added `mc-agent/docker-entrypoint.sh`: starts as root, `chown`s the volume mount points to
      `workspace` on every boot (repairs volumes an older root-owning image already created), then
      drops privileges via `setpriv` and execs the agent (PID 1, clean SIGTERM). Dockerfile now
      pre-creates `~/.ssh` (0700) + `~/.config` owned by `workspace` and uses the entrypoint.
- [x] Spawn watchdog (`TerminalPane` + `UserTerminalPane`): a sandbox spawn that never gets an
      agent ack (spawned/output/exit within 12s) now surfaces a retryable hint instead of a
      forever-blank terminal. Cleared on first sign of life.
- [x] Agent logs successful spawns (`pty.spawn.ok`) so a working spawn is observable, not just
      failures.

---

## References (repo)

- Default agent image baseline: `docker/daytona-agent/Dockerfile`
- Local PTY + hooks: `electron/pty-manager.ts`, `electron/agent-hooks.ts`
- Remote PTY reference protocol: `src/server/services/daytona-remote-pty.ts`
- Terminal UI fork point: `src/components/views/TerminalPane.tsx`
- File browser/editor IPC to mirror over RPC: `electron/file-handlers.ts`,
  `window.electronAPI.files.*` (`electron/preload.ts`),
  `src/components/views/FileEditorDialog.tsx`, `FileFinderDialog.tsx`
- Git diff UI + service to mirror over RPC: `src/components/views/GitDiffView/*`,
  `src/server/services/git.ts`
- Hosted workspace path convention: `src/shared/hosted-workspace.ts` (container uses
  `/workspace` similarly)
