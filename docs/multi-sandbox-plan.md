# Multi-Sandbox Plan

Status: **proposed** (awaiting approval before Phase 1).

Evolve the sandbox runner from one global Docker container into **multiple
isolated execution environments ("sandboxes")**, each with its own set of
projects, so unrelated work (e.g. Flexion vs. Client) can never bleed across an
AI agent's reach. Builds on `docs/docker-sandbox-runner-plan.md` (single-sandbox
foundation), which stays accurate for the per-container internals.

---

## 1. Use case

> At work I have Flexion projects and Client projects. A Client agent must never
> be able to read, run, or reach Flexion code, credentials, or services — and
> vice-versa. I want to pick a sandbox from a header dropdown and see a
> completely different set of projects scoped to it.

---

## 2. Locked decisions

| Decision | Choice |
| --- | --- |
| Concurrency | **Keep all sandboxes running**; UI attaches to the selected one. Background agents keep working when you switch. |
| Isolation | **Full**: project files, agent logins, network, and secrets/env are all per-sandbox. |
| Per-sandbox config | **Fully independent** (own image/Dockerfile, ports, git-auth, env). |
| Scope model | **Local (host) is a first-class, default scope.** Every project belongs to exactly one scope. |
| Ports | **Auto-assigned host ports** per sandbox (declare container ports; MC maps each to a stable free host port). |
| Delete | **Destroy everything** (container + volumes + project rows) behind a typed confirmation. |
| Remote VMs | **Model a `kind` discriminator now** (`local-docker` today, `remote-vm` planned); build local-docker only. |
| Rollout | **Phased**; Phase 1 after approval of this doc. |

---

## 3. Concepts

- **Scope** — the context a project lives in. Exactly one of: `Local` (the host
  machine) or a specific **sandbox**.
- **Sandbox** — a named, isolated execution environment with a `kind`
  (`local-docker` now). Owns its own container, volumes, ports, credentials, and
  the projects scoped to it.
- **Active scope** — the scope currently selected in the header dropdown. Drives
  the visible project list and which agent connection new terminals attach to.
- **Local** — implicit, undeletable scope = today's host runtime. Default for
  existing and new projects until a sandbox is chosen.

---

## 4. Data model

### 4.1 New `sandboxes` table (Drizzle, in `missioncontrol.db`)

Lives alongside `projects` (`src/db/schema.ts`) so it is the single source of
truth readable by **both** the renderer/server (dropdown + scoping) and the
Electron main process (which already opens this DB read-only in
`electron/project-roots.ts` for CWD gating).

```ts
export const sandboxes = sqliteTable("sandboxes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").$type<"local-docker" | "remote-vm">().notNull().default("local-docker"),
  color: text("color"),                 // dropdown chip
  // --- fully-independent runtime config ---
  imageTag: text("image_tag"),          // null = bundled default image
  dockerfilePath: text("dockerfile_path"),
  buildArgs: text("build_args"),        // JSON: Record<string,string>
  gitAuthMode: text("git_auth_mode").$type<"none"|"copy-host"|"generate">().notNull().default("none"),
  declaredPorts: text("declared_ports"),// JSON: number[] container ports the user wants reachable
  env: text("env"),                     // JSON: Record<string,string> per-sandbox secrets/env
  // --- managed (MC-derived, not user-set) ---
  hostAgentPort: integer("host_agent_port"),     // auto-assigned host port → container 9333
  portMap: text("port_map"),            // JSON: Record<containerPort, hostPort> auto-assigned
  pairingToken: text("pairing_token"),  // per-sandbox; never leaves main
  // --- remote-vm (future, nullable now) ---
  remoteConfig: text("remote_config"),  // JSON: { host, user, ... } — unused until kind=remote-vm
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
```

Derived resource names (not stored — computed from `id`):
- container: `mc-sandbox-<id>`
- volumes: `mc-sb-<id>-workspace`, `-config`, `-ssh`, `-claude`, `-codex`, `-cursor`, `-opencode`
- network: `mc-net-<id>` (its own bridge)

### 4.2 `projects.sandboxId`

```ts
sandboxId: text("sandbox_id").references(() => sandboxes.id, { onDelete: "cascade" }),
// NULL = Local (host). Indexed.
```

- `onDelete: cascade` implements "destroy everything" for project rows.
- New index `projects_sandbox_idx` on `sandboxId`.
- **`path` semantics become scope-relative:** for Local, `path` is the host
  absolute path (today's meaning). For a sandbox, `path` is the in-container
  workspace path (`/workspace/<slug>`). A sandboxed project may have **no host
  path at all** (cloned straight into the container).

### 4.3 What replaces global sandbox settings

Today's single `app_settings` blob (`electron/sandbox-settings.ts`:
`enabled`, `runtimeMode`, `imageTag`, `publishedPorts`, …) is superseded:
- Per-sandbox config → the `sandboxes` row.
- Global `runtimeMode: host|docker` → **removed**; a project's runtime is implied
  by its scope (Local→host PTY, sandbox→remote PTY).
- A small global block remains: `sandboxesEnabled` (master switch that shows/hides
  the dropdown) and `activeScopeId` (last-selected scope, for restore on launch).

---

## 5. Manager architecture: singleton → registry

`electron/sandbox-manager.ts` is today a module-level singleton (one
`currentState`, one `agent`, one `opEpoch`, one `CONTAINER_NAME`). Refactor into:

- **`SandboxInstance`** — a class holding the per-sandbox state currently held in
  module vars (state machine, `SandboxAgentClient`, reconnect timer, op epoch,
  log tail, pairing token). One container + one WS connection each.
- **`SandboxRegistry`** — `Map<sandboxId, SandboxInstance>`; lifecycle
  (`ensure`, `start`, `stop`, `destroy`), reconcile-on-launch (restore "keep all
  running"), and fan-out of state/log events tagged with `sandboxId`.
- **IPC carries `sandboxId`.** Every `sandbox:*` and `remotePty:*` / `remoteFs:*`
  / `remoteGit:*` channel gains a `sandboxId` argument so the renderer addresses
  the right instance. The renderer passes the project's `sandboxId` (or the
  active scope).
- `pendingReplays` etc. move from module scope into the instance.

This is the largest refactor and is isolated to Phase 2.

---

## 6. Container topology per sandbox

`renderComposeFile` becomes a function of a `sandboxes` row instead of the global
settings:
- `container_name: mc-sandbox-<id>`, all volumes namespaced `mc-sb-<id>-*`.
- **Auto host ports:** internal agent port stays `9333`; MC allocates a free host
  port (`hostAgentPort`) and binds `127.0.0.1:<hostAgentPort>:9333`. For each
  `declaredPorts` entry, MC allocates a stable free host port, persists it in
  `portMap`, and binds `127.0.0.1:<hostPort>:<containerPort>`. Allocation reuses
  the persisted mapping when free; re-picks only on conflict.
- **Network isolation:** each sandbox gets its own bridge network `mc-net-<id>`
  (no shared network → containers can't address each other directly). Caveat to
  document: a published port is reachable via `host.docker.internal:<hostPort>`
  from *any* container; Phase 3 evaluates firewalling/host-gateway scoping to
  close that path.
- Entrypoint volume-chown logic (already in `mc-agent/docker-entrypoint.sh`) is
  unchanged — it operates on fixed in-container paths.

---

## 7. Isolation model (the four dimensions)

1. **Project files** — separate container + `mc-sb-<id>-workspace` volume per
   sandbox. An agent only ever sees its own sandbox's `/workspace`.
2. **Agent logins** — per-sandbox credential volumes (`-claude`, `-codex`,
   `-cursor`, `-opencode`, `-config`, `-ssh`). You log into each sandbox's agents
   separately (Client account in Client sandbox, Flexion account in Flexion).
   `CLAUDE_CONFIG_DIR` etc. point into the per-sandbox volume.
3. **Network** — own bridge per sandbox; document/close the host-loopback path
   (above).
4. **Secrets / env** — per-sandbox `env` + `buildArgs` injected only into that
   container.

---

## 8. UX

- **Header scope dropdown** (in `TopBar` `centerActions`, gated on
  `sandboxesEnabled`): lists `Local` + each sandbox with a status dot
  (stopped / starting / connected) and its name/color, plus **+ New sandbox**.
  Selecting a scope re-scopes the project list and points new terminals at that
  instance. Persists `activeScopeId`.
- **Sandbox CRUD:**
  - *Create* — name, color, and independent config (image/Dockerfile, declared
    ports, git-auth, env). Starts the container.
  - *Edit* — change config; warns that port/volume-affecting edits recreate the
    container.
  - *Delete* — typed-confirmation dialog ("type the sandbox name") → stop +
    `compose down -v` (volumes) + cascade-delete project rows.
- **Project list** — filtered to the active scope. Existing project-creation /
  "add project" flow becomes scope-aware: when a sandbox is active, the clone
  happens **into that sandbox's container** (reusing the remote-clone path we
  moved out of settings); Local keeps host paths.
- **Launch URLs** — resolve `launchUrl` against the sandbox's `portMap` so
  `localhost:<containerPort>` opens the correct mapped host port.
- **Settings page** — `SandboxSettingsPage` becomes per-sandbox (selected from
  the dropdown or a list), plus a global "Enable sandboxes" switch.

---

## 9. Runtime selection changes

`src/lib/sandbox-runtime.ts` (`isDockerSandboxRuntime`) currently reads a global
mode. It becomes **per-project**: a project with `sandboxId == null` → host
PTY (`electron.pty`); a project in a sandbox → that sandbox's remote PTY
(`electron.remotePty` addressed by `sandboxId`). `TerminalPane` already branches
on this boolean; it gains the `sandboxId` to address the right instance.

---

## 10. Remote-VM abstraction (future)

The `kind` discriminator and nullable `remoteConfig` are introduced now so a
`remote-vm` sandbox is **additive**: a `RemoteSandboxInstance` implementing the
same interface as the Docker one (start/stop/connect, PTY/FS/git RPC over the
existing mc-agent WS protocol, just reached over SSH/tunnel instead of a local
published port). No `remote-vm` behavior is built in Phases 1–4. This is distinct
from today's web/Daytona hosted mode (a different *deployment*, not folded in).

---

## 11. Migration

One-time, idempotent, on first launch after upgrade:
1. Create `sandboxes` + `projects.sandboxId` (default `NULL` → all existing
   projects become **Local**, matching today's host behavior).
2. If the old global sandbox was enabled (`sandbox.enabled && runtimeMode==docker`),
   create one `sandboxes` row **"Default"** carrying the old config, and **re-tag
   its existing volumes** (`mc-workspace`, `mc-agent-*`) to the new `mc-sb-<id>-*`
   names (or alias them) so the current login/clones survive. Projects the user
   was running in the container are reassigned to "Default".
3. Drop the global `runtimeMode` setting; keep `sandboxesEnabled` (seeded from old
   `enabled`) and `activeScopeId` (seed = "Default" if migrated, else `Local`).

Migration detail (volume rename vs. alias) is finalized in Phase 2 against a real
upgrade test so no existing auth/clones are lost.

---

## 12. Phased rollout

- **Phase 1 — Model + scoping + dropdown shell. ✅ DONE.** `sandboxes` table +
  `projects.sandboxId` (migration 0009); parity migration (everything → Local;
  "Default" sandbox if the global Docker sandbox was active); sandbox CRUD
  service + `/api/sandboxes` + query hook; header `ScopeDropdown` (Local +
  sandboxes + New sandbox) gated on `multiSandbox.enabled`; dashboard filters to
  the active scope; new projects inherit the active scope. Runtime still uses the
  legacy global `sandbox.enabled/runtimeMode` (behavior parity) — **per-project
  runtime selection deferred to Phase 2** (it belongs with the registry, where a
  project's terminal attaches to its sandbox's container). Active scope + enabled
  flag live in server `app_settings` (`multiSandbox.activeScope` / `.enabled`).
- **Phase 2 — Manager registry + per-sandbox containers + per-project runtime.
  ✅ CODE-COMPLETE (needs Docker verification).** Singleton manager → `SandboxRegistry`
  + `SandboxInstance` (`sandbox-registry.ts`, unit-tested state machine + op-epoch
  guard). Per-sandbox compose (`renderSandboxCompose`: `mc-sandbox-<id>` container,
  `mc-sb-<id>-*` volumes, own `mc-net-<id>` bridge) + auto host-port allocation
  (`sandbox-ports.ts`). Concurrent containers ("keep all running" via `reconcile`).
  Electron-main reads `sandboxes` rows + persists ports (`sandbox-store.ts`).
  **Routing decision:** rather than thread `sandboxId` through every remote
  PTY/fs/git call, the manager routes them to the *active sandbox* (set via
  `sandbox:setActive` when the scope changes) — correct because the project list
  is filtered to the active scope, so visible terminals belong to it. PTY input
  routes by `ptyId → owning sandbox`. `isDockerSandboxRuntime` now = "is a sandbox
  scope active" (`getState().status !== "disabled"`).
  **Deferred to P4:** per-sandbox config UI (image/ports/git-auth — new sandboxes
  use the default image + agent port only); a delete-sandbox UI calling
  `sandbox.destroy` (container/volume teardown); retiring the now-vestigial legacy
  "Enable Docker sandbox" global toggle.
- **Phase 3 — Isolation hardening.** Per-sandbox credential volumes + env +
  build args; per-sandbox bridge network; address the host-loopback leak.
- **Phase 4 — UX polish.** Create/edit/destroy flows + typed-confirmation,
  scope-aware add-project (clone into sandbox), launch-URL port mapping, dropdown
  status, settings-page restructure.
- **Phase 5 — Remote-VM kind (future).** `RemoteSandboxInstance` over SSH/tunnel.

Each phase ships green (typecheck + tests) and behavior-compatible with the prior.

---

## 13. Risks / open questions

- **Volume migration** of the existing global sandbox without losing the user's
  current logins/clones — validate against a real upgrade (Phase 2).
- **Host-loopback network leak** — published ports are reachable cross-container
  via `host.docker.internal`; needs a concrete mitigation in Phase 3 or an
  explicit documented limitation.
- **Resource ceiling** — "keep all running" with many sandboxes = many
  Node/agent processes + images; consider an idle-suspend policy later.
- **Port exhaustion / stability** — auto-assigned host ports must stay stable
  across restarts; persisted `portMap` + reuse-if-free handles the common case.
- **Project move between scopes** — out of scope for now (sandbox clones are
  in-container); revisit if needed.
