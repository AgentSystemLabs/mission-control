# mc-agent — Mission Control sandbox runner agent

The process that runs **inside** the Docker sandbox container. Electron connects
to it as a WebSocket client; the agent drives PTYs and serves file/git RPC for
the in-container repos. Part of the Docker Sandbox Runner
(`docs/docker-sandbox-runner-plan.md`).

## What it does

- **WebSocket server** on `${MC_AGENT_BIND_HOST:-0.0.0.0}:${MC_AGENT_PORT:-$PORT:-9333}`,
  gated by a bearer API key.
- **PTY lifecycle** — spawn / write / resize / kill / replay, with seq-numbered
  output and a 1 MB ring buffer for reconnect replay. Reuses the exact host
  spawn allow-list (`src/shared/pty-spawn-policy.ts`) with `/workspace` as the
  only project root.
- **File RPC** — `fs.list / fs.read / fs.write / fs.watch / fs.unwatch`, confined
  to `/workspace`, mirroring `electron/file-handlers.ts`.
- **Git RPC** — `git.status / git.diff / git.clone`, reusing the shared parser
  (`src/shared/git-status.ts`) so the wire contract matches the host HTTP API.
- **Hook bootstrap** — installs Mission Control agent hooks pointed at
  `host.docker.internal` so task status flows back to the host.
- **Health** — `GET /health` returns liveness + version JSON.

## Boundaries

- Confines every PTY cwd, file path, and git repo path to `/workspace`.
- Never touches SQLite or project/task CRUD — those stay host-side.

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `MC_AGENT_PORT` | `PORT` or `9333` | WS + health port |
| `PORT` | _(empty)_ | Railway-provided port fallback |
| `MC_AGENT_BIND_HOST` | `0.0.0.0` | Bind address; use `::` for dual-stack private networks |
| `MC_WORKSPACE_ROOT` | `/workspace` | Confinement root for spawns + RPC |
| `MC_AGENT_API_KEY` | _(empty)_ | Required bearer secret for remote deployments |
| `MC_PAIRING_TOKEN` | _(empty)_ | Local Docker compatibility fallback for the same bearer secret |
| `MC_HOOK_API_HOST` | `host.docker.internal` | Host the in-container hooks POST to |

`MC_AGENT_API_KEY` and `MC_PAIRING_TOKEN` are equivalent at runtime. Prefer
`MC_AGENT_API_KEY` for user-managed remote agents.

## Build

```sh
pnpm build:mc-agent   # esbuild → mc-agent/dist/mc-agent.cjs (node-pty external)
```

Runtime deps (`ws`, `ignore`) are bundled. `node-pty` is installed in the image.
The shared logic (spawn policy, hook install, git parser) is imported from
`src/shared/**` and inlined at bundle time — single source of truth with the
Electron host.

## Deploy on Railway

Use the standalone Dockerfile from the repo root:

```sh
docker/sandbox-agent/Dockerfile
```

Railway setup:

1. Create a Railway service from this repository.
2. Set the Dockerfile path to `docker/sandbox-agent/Dockerfile`.
3. Add `MC_AGENT_API_KEY` as a long random secret.
4. Optionally mount a volume at `/workspace` if you want repositories to survive redeploys.
5. Generate a public domain and use `https://...` in Mission Control. The app
   normalizes it to `wss://...` and sends `Authorization: Bearer <api key>`.

Do not set `MC_AGENT_PORT` on Railway unless you also set Railway's `PORT` to the
same value. The agent reads Railway's injected `PORT` by default.

## Deploy on Any VM

Build and run from the repo root:

```sh
docker build -f docker/sandbox-agent/Dockerfile -t mission-control/sandbox-agent:latest .
docker run -d \
  --name mc-agent \
  -e MC_AGENT_API_KEY="$(openssl rand -hex 32)" \
  -v mc-agent-workspace:/workspace \
  -p 9333:9333 \
  mission-control/sandbox-agent:latest
```

Then create a Mission Control sandbox of type **Remote VM** with:

- Agent URL: `wss://<your-domain>` for public access, or `ws://localhost:9333`
  / private-network `ws://` URLs over a tunnel or VPN
- API key: the value of `MC_AGENT_API_KEY`

For public access, put Caddy, nginx, Cloudflare Tunnel, Tailscale Funnel, or another
terminating proxy in front of the container and point Mission Control at the
`https://`/`wss://` URL.

## Ports and Previews

Railway works well for the agent's single HTTP/WebSocket port. It is not a good
fit for dynamically publishing arbitrary dev-server ports from inside this same
sandbox. Railway public networking exposes a configured service port/domain, not
an unbounded set of ports started later by user commands.

For now, remote sandboxes support PTY, file, git, and agent execution. Previewing
apps running inside the remote workspace needs a separate strategy, such as:

- a reverse proxy inside the VM that multiplexes known app ports over one public domain,
- a tunnel per project/session,
- deploying the app as its own Railway service,
- or connecting Mission Control through a VPN/private network where those ports are reachable.

## Security

Treat a public mc-agent URL as a privileged shell exposed to the internet. The
bearer API key gates access, but anyone who obtains it can:

- spawn PTYs and run commands,
- read and write files under `/workspace`,
- clone repositories,
- use credentials stored inside the remote agent home directory.

Recommended posture:

- Use a long random `MC_AGENT_API_KEY` and rotate it if it may have leaked.
- Prefer `wss://` for public access. Mission Control rejects plaintext `ws://`
  for public hostnames; use plaintext only for localhost/private/tunneled hosts.
- Prefer SSH tunnels, VPN/VPC, WireGuard/Tailscale, or private networking over a public domain.
- Prefer Generate a sandbox key on shared or public remote VMs; copy-host uploads your host private keys to the remote over the agent connection.
- Keep `/health` public but minimal; it intentionally returns only liveness and agent version.

Railway private networking is only reachable by services in the same Railway
project/environment. A desktop Mission Control app on your laptop cannot directly
reach `*.railway.internal` unless you provide a tunnel, gateway, or VPN into that
private network.
