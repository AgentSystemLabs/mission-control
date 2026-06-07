# Remote VM CLI

Mission Control can provision a cloud VM, install `mission-control-agent` directly on the host, and store it as a `remote-vm` sandbox in `missioncontrol.db`.

The VM does not run Docker. The bootstrap script installs system packages, Node 24, `pnpm`, Claude Code, Codex, OpenCode, Cursor agent, and `@agentsystemlabs/mission-control-agent` on Ubuntu 24.04. The agent runs under a dedicated `workspace` user with passwordless sudo.

In the desktop app, open the scope switcher next to the selected project in the header and choose **New sandbox** — it provisions an AWS EC2 sandbox (with optional SSH-key copy, an idle auto-stop window, and a custom setup script). The CLI command below uses the same provisioner.

## AWS EC2

```bash
pnpm remote-vm deploy aws \
  --name client-vm \
  --region us-east-1 \
  --size t3.medium
```

Defaults:

- Image: latest Ubuntu 24.04 amd64 SSM alias.
- Size: `t3.medium`.
- Inbound network: agent port `9333` only, restricted to your detected public IPv4 `/32`.
- Agent port: bound to `0.0.0.0:9333` on the VM and protected by the generated API key plus cloud firewall.

Use `--access-cidr <cidr>` when auto-detecting your public IP is not appropriate. Use `--subnet-id` for a non-default VPC, or `--security-group-id` to use an existing security group. `--key-name`, `--identity-file`, and `--local-port` are optional SSH debugging/tunnel settings only.

Additional AWS deploy flags:

- `--git-auth-mode copy-host|generate|none` — `copy-host` (the default) pushes your readable `~/.ssh` keys to the VM over the encrypted agent connection on first connect so it can clone private repos. `none` disables it.
- `--idle-timeout <minutes>` — stop the EC2 instance after this many minutes with no agent activity (PTY I/O or RPC). Default `30`; `0` disables. EBS storage is preserved, so a later resume keeps the workspace. The watchdog runs on the VM as a systemd timer, so it stops the box even when Mission Control is closed.
- `--setup-script-b64 <base64>` — a base64-encoded bootstrap script that runs once on the VM (as root) after the agent is healthy, isolated so a non-zero exit is logged (`/var/log/mission-control-setup.log`) but never fails provisioning. The desktop app collects this as a plain-text "Setup script" field.

## Connect Mission Control

After deployment, Mission Control stores the sandbox agent URL as `ws://<public-ip>:9333/` and connects directly with the generated API key. No SSH key or tunnel is required.

If you deploy with optional SSH metadata, `pnpm remote-vm tunnel <sandbox-id>` still starts a local tunnel for debugging.

Useful commands:

```bash
pnpm remote-vm list
pnpm remote-vm status <sandbox-id>
pnpm remote-vm pause <sandbox-id> --yes
pnpm remote-vm resume <sandbox-id>
pnpm remote-vm reconcile <sandbox-id>
pnpm remote-vm destroy <sandbox-id> --yes
```

`reconcile` syncs the saved status with the cloud's real instance state — e.g. it marks a sandbox `paused` after the idle watchdog (or a manual `aws ec2 stop-instances`) has stopped it. The desktop app runs this automatically when you open the scope switcher and before switching to a sandbox, so an idle-stopped VM shows as **Paused** and clicking it resumes the instance.

## Credentials And Failure Handling

- AWS requires `aws` to be installed and authenticated. The deploy command checks `sts get-caller-identity` and the instance type before creating an instance. If `--key-name` is provided, it also validates the EC2 key pair.
- If cloud creation succeeds but bootstrap fails, the sandbox row remains in SQLite with `status: "provisioning_failed"` and the cloud provider id so it can be inspected or destroyed.
- If SQLite writing fails after cloud creation, the CLI prints the exact provider cleanup command.
