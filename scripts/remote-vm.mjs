#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const requireFromHere = createRequire(import.meta.url);
const REPO_ROOT = process.cwd();
const AGENT_PORT = 9333;
// HTTPS port the on-VM TLS sidecar terminates on, forwarding to the loopback agent.
const AGENT_TLS_PORT = 443;
const DEFAULT_LOCAL_TUNNEL_PORT = 19333;
const DEFAULT_AWS_SIZE = "t3.medium";
const DEFAULT_DO_SIZE = "s-2vcpu-4gb";
const DEFAULT_DO_IMAGE = "ubuntu-24-04-x64";
const DEFAULT_AWS_IMAGE =
  "resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id";
const DEFAULT_AWS_SECURITY_GROUP = "mission-control-remote-vm-agent";

// --- Golden AMI ---------------------------------------------------------------
// AgentSystemLabs publishes a pre-baked public AMI (one per region) with every
// tool already installed. deployAws resolves the AMI for the target region/arch
// from a small manifest and launches from it with the slim boot user-data, so a
// cold boot drops from minutes to ~seconds. When no entry exists (region not yet
// published, offline, arch mismatch), deploy falls back to the full-install path
// on the stock Ubuntu base — nothing ever hard-breaks.
//
// The hosted manifest is published by the mc-sandbox repo's workflow to academy
// (github.com/AgentSystemLabs/mc-sandbox). It takes precedence; the bundled
// golden-ami-manifest.json below is the offline fallback.
const GOLDEN_AMI_MANIFEST_URL =
  process.env.MC_GOLDEN_AMI_MANIFEST_URL?.trim() ||
  "https://agentsystem.dev/api/golden-ami/manifest";
// Shipped alongside this script; the offline fallback when the hosted manifest is
// unreachable. Holds the last known-good AMI so deploys stay fast even offline.
const BUNDLED_GOLDEN_AMI_MANIFEST = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "golden-ami-manifest.json",
);
// Root of trust for golden AMIs. The manifest's own `owner` field is untrusted
// data (a compromised CDN object or a hostile MC_GOLDEN_AMI_MANIFEST_URL could set
// both the AMI id AND a matching attacker-owned account). Pinning launches to a
// known account id defeats that: a resolved AMI must be owned by THIS account, not
// merely by whoever wrote the manifest.
//
// The AgentSystemLabs AWS account that publishes the golden AMIs (the account the
// mc-sandbox repo's build runs under). Pinning here means a resolved AMI must be
// owned by THIS account, not merely by whoever wrote the manifest.
// Override per-environment with MC_GOLDEN_AMI_OWNER.
const GOLDEN_AMI_OWNER_DEFAULT = "493255580566";
const GOLDEN_AMI_OWNER_PIN = process.env.MC_GOLDEN_AMI_OWNER?.trim() || GOLDEN_AMI_OWNER_DEFAULT;
// Railway: a single shared project holds one service per sandbox. The agent is
// deployed from the public GitHub repo and reached over Railway's edge TLS.
const MC_RAILWAY_PROJECT_NAME = "mission-control";
const MC_AGENT_REPO = "AgentSystemLabs/mission-control-agent";
const MC_AGENT_REPO_URL = `https://github.com/${MC_AGENT_REPO}.git`;
const MC_RAILWAY_VOLUME_MOUNT = "/home/workspace";
/** Config-as-code path in mission-control-agent (see deploy/railway/README.md). */
const MC_RAILWAY_CONFIG_FILE = "deploy/railway/railway.json";
const REMOTE_CONFIG_VERSION = 1;
const ACTIVE_SCOPE_KEY = "multiSandbox.activeScope";
const SANDBOXES_ENABLED_KEY = "multiSandbox.enabled";

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export function parseFlagArgs(args) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      const key = arg.slice(2, eq);
      flags[key] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return { flags, positionals };
}

function strFlag(flags, name, fallback = "") {
  const value = flags[name];
  if (value === undefined || value === true) return fallback;
  return String(value).trim();
}

function boolFlag(flags, name) {
  return flags[name] === true || flags[name] === "true" || flags[name] === "1";
}

function intFlag(flags, name, fallback) {
  const raw = strFlag(flags, name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) throw new CliError(`--${name} must be an integer.`);
  return value;
}

function required(value, message) {
  if (!value) throw new CliError(message);
  return value;
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function randomSecret() {
  return randomBytes(32).toString("hex");
}

function resolveUserDataDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.MC_USER_DATA_DIR?.trim()) return env.MC_USER_DATA_DIR.trim();
  if (platform === "darwin") return path.join(home, "Library/Application Support/MissionControl");
  if (platform === "win32") return path.join(home, "AppData/Roaming/MissionControl");
  return path.join(home, ".config/MissionControl");
}

function expandHome(file) {
  if (!file) return "";
  if (file === "~") return os.homedir();
  if (file.startsWith("~/")) return path.join(os.homedir(), file.slice(2));
  return file;
}

function normalizeCidr(cidr) {
  const value = cidr.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}\/(?:\d|[12]\d|3[0-2])$/.test(value)) {
    throw new CliError(`Invalid CIDR "${cidr}". Use a value like 203.0.113.10/32.`);
  }
  const [ip] = value.split("/");
  for (const part of ip.split(".")) {
    const n = Number.parseInt(part, 10);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new CliError(`Invalid CIDR "${cidr}". IPv4 octets must be 0-255.`);
    }
  }
  return value;
}

async function detectPublicIpCidr() {
  const ip = await new Promise((resolve, reject) => {
    const req = https.get("https://checkip.amazonaws.com/", { timeout: 8_000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(body.trim());
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timed out"));
    });
    req.on("error", reject);
  });
  return normalizeCidr(`${ip}/32`);
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error || result.error.code !== "ENOENT";
}

function assertCommand(command, installHint) {
  if (!commandExists(command)) {
    throw new CliError(`${command} CLI is required. ${installHint}`);
  }
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    env: opts.env ?? process.env,
    encoding: "utf8",
    maxBuffer: opts.maxBuffer ?? 20 * 1024 * 1024,
    timeout: opts.timeout,
  });
  return {
    code: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? result.error.message : ""),
    error: result.error ?? null,
  };
}

function runChecked(command, args, opts = {}) {
  const result = run(command, args, opts);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "command failed").trim();
    throw new CliError(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

function parseJsonOutput(stdout, context) {
  try {
    return JSON.parse(stdout || "null");
  } catch (err) {
    throw new CliError(`${context} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Railway prints interactive-looking status lines before JSON on stdout (e.g.
// "> Select a workspace …"). Strip those so --json output is parseable.
export function extractJsonFromCliOutput(stdout, context) {
  const text = (stdout || "").trim();
  if (!text) {
    throw new CliError(`${context} returned no output`);
  }
  const start = text.search(/[\[{]/);
  if (start === -1) {
    throw new CliError(`${context} returned invalid JSON: no JSON object or array found in output`);
  }
  try {
    return JSON.parse(text.slice(start));
  } catch (err) {
    throw new CliError(`${context} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function selectRailwayWorkspaceId(workspaces, preferred) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new CliError("Railway account has no workspaces. Create one at https://railway.com first.");
  }
  const pref = (preferred || "").trim();
  if (pref) {
    const match = workspaces.find(
      (ws) => ws.id === pref || ws.name?.trim().toLowerCase() === pref.toLowerCase(),
    );
    if (!match) {
      throw new CliError(
        `Railway workspace "${pref}" not found. Run \`railway whoami --json\` to list workspaces, then set RAILWAY_WORKSPACE.`,
      );
    }
    return match.id;
  }
  if (workspaces.length === 1) return workspaces[0].id;
  throw new CliError(
    `Railway account has ${workspaces.length} workspaces. Set RAILWAY_WORKSPACE to the workspace id or name before deploying.`,
  );
}

function firstItem(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function awsArgs(opts, args) {
  const out = [];
  if (opts.profile) out.push("--profile", opts.profile);
  if (opts.region) out.push("--region", opts.region);
  out.push(...args);
  return out;
}

function awsJson(opts, args) {
  const stdout = runChecked("aws", awsArgs(opts, [...args, "--output", "json"]));
  return parseJsonOutput(stdout, "aws");
}

function doctlJson(args) {
  const stdout = runChecked("doctl", [...args, "--output", "json"]);
  return parseJsonOutput(stdout, "doctl");
}

// --- Golden AMI resolution ----------------------------------------------------

// A manifest is tiny; cap the body so a hostile/oversized response can't grow
// memory before we even parse it.
const GOLDEN_AMI_MANIFEST_MAX_BYTES = 1_000_000;

function httpsGetText(url, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = "";
      let bytes = 0;
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > GOLDEN_AMI_MANIFEST_MAX_BYTES) {
          req.destroy(new Error("response too large"));
          return;
        }
        body += chunk;
      });
      res.on("end", () => resolve(body));
    });
    // Socket `timeout` is idle-only; add a wall-clock deadline so a slow-drip
    // server can't hold the deploy open indefinitely.
    const deadline = setTimeout(() => req.destroy(new Error("deadline exceeded")), timeoutMs * 2);
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
  });
}

/**
 * Parse + shape-validate a golden AMI manifest. Returns the normalized object or
 * null when the payload is missing required fields, so a malformed/half-written
 * manifest can never push a bad AMI id into a launch.
 */
export function parseGoldenAmiManifest(text) {
  let raw;
  try {
    raw = JSON.parse(text || "null");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const images = raw.images && typeof raw.images === "object" ? raw.images : null;
  if (!images) return null;
  const cleanImages = {};
  for (const [region, amiId] of Object.entries(images)) {
    if (typeof region === "string" && typeof amiId === "string" && /^ami-[0-9a-f]+$/i.test(amiId)) {
      cleanImages[region] = amiId;
    }
  }
  return {
    schemaVersion: Number(raw.schemaVersion) || 1,
    version: typeof raw.version === "string" ? raw.version : null,
    agentVersion: typeof raw.agentVersion === "string" ? raw.agentVersion : null,
    arch: typeof raw.arch === "string" ? raw.arch : "x86_64",
    owner: typeof raw.owner === "string" && /^\d{12}$/.test(raw.owner) ? raw.owner : null,
    builtAt: typeof raw.builtAt === "string" ? raw.builtAt : null,
    images: cleanImages,
  };
}

function readBundledGoldenAmiManifest() {
  try {
    return parseGoldenAmiManifest(fs.readFileSync(BUNDLED_GOLDEN_AMI_MANIFEST, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Resolve the golden AMI manifest: prefer the hosted copy (so new AMIs ship without
 * an app release), fall back to the manifest bundled with the app (offline / fetch
 * failure). Returns { manifest, source } where source is "remote" | "bundled" | "none".
 */
export async function fetchGoldenAmiManifest({ url = GOLDEN_AMI_MANIFEST_URL, timeoutMs = 8_000 } = {}) {
  try {
    const text = await httpsGetText(url, timeoutMs);
    const manifest = parseGoldenAmiManifest(text);
    if (manifest) return { manifest, source: "remote" };
    // A reachable-but-malformed manifest is its own failure mode; say so before
    // silently dropping to the (possibly stale) bundled copy.
    console.error(`[remote-vm] golden AMI manifest at ${url} was malformed; falling back to bundled`);
  } catch (err) {
    console.error(
      `[remote-vm] golden AMI manifest fetch failed (${url}); falling back to bundled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const bundled = readBundledGoldenAmiManifest();
  if (bundled) return { manifest: bundled, source: "bundled" };
  return { manifest: null, source: "none" };
}

/**
 * Infer the CPU architecture an EC2 instance type runs. Graviton (arm64) families
 * embed a digit+'g' (t4g, m7g, c7gn, x2gd, im4gn, is4gen) or are the a1 family;
 * everything else is x86_64. A golden AMI is single-arch, so a mismatch must fall
 * back rather than launch an incompatible image.
 */
export function archForInstanceSize(size) {
  const family = String(size || "").trim().toLowerCase().split(".")[0];
  if (!family) return "x86_64";
  if (family === "a1" || /\dg[a-z]*$/.test(family)) return "arm64";
  return "x86_64";
}

/**
 * Pure resolution: given a manifest, target region, and arch, return the launchable
 * AMI descriptor or null. Never throws — a miss (region not published, arch mismatch)
 * is a normal fallback signal, not an error.
 */
export function resolveGoldenAmi({ manifest, region, arch }) {
  if (!manifest || !manifest.images) return null;
  if (manifest.arch && arch && manifest.arch !== arch) return null;
  const amiId = manifest.images[region];
  if (!amiId) return null;
  return {
    amiId,
    owner: manifest.owner,
    region,
    arch: manifest.arch,
    version: manifest.version,
    agentVersion: manifest.agentVersion,
  };
}

/**
 * Confirm a resolved AMI is genuinely owned by the manifest's account (anti-spoof:
 * a third party can't squat a same-named public AMI) and is in the available state.
 * describe-images --owners filters server-side, so a wrong owner returns no rows.
 */
function verifyAmiOwner(opts, amiId, expectedOwner) {
  if (!expectedOwner) return false;
  if (GOLDEN_AMI_OWNER_PIN && GOLDEN_AMI_OWNER_PIN !== expectedOwner) return false;
  try {
    const result = awsJson(opts, [
      "ec2",
      "describe-images",
      "--image-ids",
      amiId,
      "--owners",
      expectedOwner,
    ]);
    const found = (result.Images ?? []).find((img) => img.ImageId === amiId);
    if (!found) return false;
    if (found.OwnerId && found.OwnerId !== expectedOwner) return false;
    if (found.State && found.State !== "available") return false;
    return true;
  } catch (err) {
    // A thrown AWS error (expired creds, throttling, permissions) is NOT the same
    // as a genuine owner mismatch — both fail closed, but only one means "spoof".
    // Log so a slow full-install fallback is traceable to its real cause.
    console.error(
      `[remote-vm] owner verification for ${amiId} errored (treating as unverified): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

// Default identity for the agent runtime, shared by the install + boot fragments.
const WORKSPACE_USER = "workspace";
const WORKSPACE_ROOT = "/workspace";
// The agent stamps this file on every PTY/RPC; the idle watchdog reads its mtime.
// /run is tmpfs, so a fresh boot/resume starts the idle clock from agent startup.
const AGENT_ACTIVITY_FILE = "/run/mission-control-agent/activity";

/**
 * Heavy, secret-free install steps: OS packages, Node, pnpm, the agent + AI CLIs,
 * and cursor-agent. This is the ONLY expensive part of provisioning and the part a
 * golden AMI bakes once. It MUST NOT contain per-instance secrets (API key, TLS
 * material), so the captured image is safe to publish as a public AMI.
 */
function renderInstallBody({ workspaceUser = WORKSPACE_USER, workspaceRoot = WORKSPACE_ROOT } = {}) {
  const home = `/home/${workspaceUser}`;
  return `apt-get update
apt-get install -y --no-install-recommends \\
  bash build-essential ca-certificates curl git gnupg jq less openssh-client openssl procps \\
  python3 python3-pip python3-venv ripgrep sudo unzip xz-utils zip zsh

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

if ! id -u ${workspaceUser} >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash ${workspaceUser}
fi
usermod -aG sudo ${workspaceUser}
echo "${workspaceUser} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${workspaceUser}
chmod 0440 /etc/sudoers.d/${workspaceUser}

install -d -o ${workspaceUser} -g ${workspaceUser} -m 0755 ${workspaceRoot}
install -d -o ${workspaceUser} -g ${workspaceUser} -m 0700 ${home}/.ssh
install -d -o ${workspaceUser} -g ${workspaceUser} -m 0755 ${home}/.config

corepack enable
corepack prepare pnpm@11.1.2 --activate
npm install -g @openai/codex@latest @anthropic-ai/claude-code@latest opencode-ai@latest @agentsystemlabs/mission-control-agent@latest

# Fail fast if the agent binary is not on PATH after install (e.g. a bad publish).
# npm's global prefix on the NodeSource deb is /usr, so the bin lands in /usr/bin —
# do NOT assume /usr/local/bin. The systemd unit below resolves it via PATH.
if ! command -v mission-control-agent >/dev/null 2>&1; then
  echo "[mission-control] FATAL: mission-control-agent not found on PATH after 'npm install -g'."
  echo "[mission-control] PATH=$PATH"
  npm ls -g --depth=0 || true
  exit 1
fi
echo "[mission-control] agent binary resolved to: $(command -v mission-control-agent)"

sudo -H -u ${workspaceUser} env HOME=${home} PATH=${home}/.local/bin:/usr/local/bin:/usr/bin:/bin bash -lc \\
  'for i in 1 2 3; do curl https://cursor.com/install -fsS | bash && break; echo "cursor-agent install attempt $i failed; retrying in 5s..."; sleep 5; done || echo "WARNING: cursor-agent install failed; continuing without it"'
ln -sf ${home}/.local/bin/cursor-agent /usr/local/bin/cursor-agent || true
ln -sf ${home}/.local/bin/agent /usr/local/bin/agent || true`;
}

/**
 * Per-instance configuration + service startup. Writes the API key and (for TLS)
 * generates a fresh self-signed cert, then enables the agent. NONE of this is baked
 * into a golden AMI — it runs at boot via cloud-init so every instance gets its own
 * secret + cert. Assumes renderInstallBody already ran (packages + workspace user +
 * agent binary present), whether baked into the AMI or run inline in the full path.
 */
function renderBootBody({
  apiKey,
  agentPort = AGENT_PORT,
  bindHost = "0.0.0.0",
  workspaceUser = WORKSPACE_USER,
  workspaceRoot = WORKSPACE_ROOT,
  tls = false,
  tlsPort = AGENT_TLS_PORT,
  idleTimeoutMinutes = 0,
  setupScript = "",
}) {
  const home = `/home/${workspaceUser}`;
  const effectiveBindHost = tls ? "127.0.0.1" : bindHost;
  const activityFile = AGENT_ACTIVITY_FILE;
  const idleSeconds = Math.max(0, Math.floor(Number(idleTimeoutMinutes) || 0)) * 60;
  const idleFragment = idleSeconds > 0 ? renderIdleWatchdog({ idleSeconds, activityFile }) : "";
  const setupFragment = setupScript && setupScript.trim() ? renderUserSetup({ setupScript }) : "";
  return `cat >/etc/mission-control-agent.env <<'MC_AGENT_ENV'
MC_AGENT_API_KEY=${apiKey}
MC_AGENT_PORT=${agentPort}
MC_AGENT_BIND_HOST=${effectiveBindHost}
MC_WORKSPACE_ROOT=${workspaceRoot}
MC_AGENT_ACTIVITY_FILE=${activityFile}
HOME=${home}
PATH=${home}/.local/bin:/usr/local/bin:/usr/bin:/bin
CLAUDE_CONFIG_DIR=${home}/.claude
MC_AGENT_ENV
chmod 0600 /etc/mission-control-agent.env

cat >/etc/systemd/system/mission-control-agent.service <<'MC_AGENT_SERVICE'
[Unit]
Description=Mission Control Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${workspaceUser}
Group=${workspaceUser}
WorkingDirectory=${workspaceRoot}
# systemd creates /run/mission-control-agent (owned by the agent user) on every
# start; the agent writes its activity heartbeat there for the idle watchdog.
RuntimeDirectory=mission-control-agent
RuntimeDirectoryMode=0755
EnvironmentFile=/etc/mission-control-agent.env
# Resolve the agent via PATH (set in the EnvironmentFile) instead of hardcoding a
# path — 'npm install -g' on the NodeSource deb installs the bin under /usr/bin,
# not /usr/local/bin.
ExecStart=/usr/bin/env mission-control-agent
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
MC_AGENT_SERVICE

systemctl daemon-reload
systemctl enable --now mission-control-agent
${tls ? renderTlsSidecar({ tlsPort, agentPort }) : ""}

ready=0
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${agentPort}/health" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" != "1" ]; then
  echo "[mission-control] FATAL: agent did not become healthy on http://127.0.0.1:${agentPort}/health"
  journalctl -u mission-control-agent --no-pager -n 120 || true
  exit 1
fi
${
    tls
      ? `
tls_ready=0
for i in $(seq 1 30); do
  if curl -fsSk "https://127.0.0.1:${tlsPort}/health" >/dev/null; then
    tls_ready=1
    break
  fi
  sleep 2
done

if [ "$tls_ready" != "1" ]; then
  echo "[mission-control] FATAL: TLS sidecar did not become healthy on https://127.0.0.1:${tlsPort}/health"
  journalctl -u mission-control-tls --no-pager -n 120 || true
  exit 1
fi
`
      : ""
  }
install -d -m 0755 /opt/mission-control-agent
${setupFragment}${idleFragment}touch /opt/mission-control-agent/bootstrap-complete`;
}

/**
 * Bake-time provisioner for the golden AMI: the heavy install steps only, with a
 * log sink and apt in noninteractive mode. Packer runs this as a shell provisioner;
 * the resulting image is captured (after a secret scrub) and published per region.
 */
export function renderInstallScript({ workspaceUser = WORKSPACE_USER, workspaceRoot = WORKSPACE_ROOT } = {}) {
  return `#!/usr/bin/env bash
set -Eeuo pipefail

exec > >(tee -a /var/log/mission-control-agent-install.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

echo "[mission-control] golden image install started at $(date -Is)"
${renderInstallBody({ workspaceUser, workspaceRoot })}
echo "[mission-control] golden image install complete at $(date -Is)"
`;
}

/**
 * Slim cloud-init user-data for an instance launched FROM a golden AMI: skips every
 * install (already baked) and only writes the per-instance secret/cert + starts the
 * agent. This is the fast path — boot drops from minutes to ~seconds.
 */
export function renderBootUserData(opts) {
  return `#!/usr/bin/env bash
set -Eeuo pipefail

exec > >(tee -a /var/log/mission-control-agent-bootstrap.log) 2>&1

echo "[mission-control] boot configuration started at $(date -Is)"
${renderBootBody(opts)}
echo "[mission-control] bootstrap complete at $(date -Is)"
`;
}

/**
 * Full cloud-init user-data: install + boot in one pass. Used as the FALLBACK when
 * no golden AMI is available for the target region/arch (and for non-AWS providers),
 * so provisioning still works end-to-end on a stock Ubuntu base image.
 */
export function renderUserData({
  apiKey,
  agentPort = AGENT_PORT,
  bindHost = "0.0.0.0",
  workspaceUser = WORKSPACE_USER,
  workspaceRoot = WORKSPACE_ROOT,
  // When true, the agent binds loopback-only and a TLS sidecar terminates HTTPS
  // on AGENT_TLS_PORT (443), forwarding decrypted traffic to the loopback agent.
  tls = false,
  tlsPort = AGENT_TLS_PORT,
  // Minutes of no agent activity (PTY I/O or RPC) before the VM stops itself.
  // 0 disables the idle watchdog.
  idleTimeoutMinutes = 0,
  // Optional user bootstrap script (plain text). Runs once, as root, after the
  // agent is healthy, isolated so a failure can't brick provisioning.
  setupScript = "",
}) {
  return `#!/usr/bin/env bash
set -Eeuo pipefail

exec > >(tee -a /var/log/mission-control-agent-bootstrap.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

echo "[mission-control] bootstrap started at $(date -Is)"
${renderInstallBody({ workspaceUser, workspaceRoot })}

${renderBootBody({
    apiKey,
    agentPort,
    bindHost,
    workspaceUser,
    workspaceRoot,
    tls,
    tlsPort,
    idleTimeoutMinutes,
    setupScript,
  })}
echo "[mission-control] bootstrap complete at $(date -Is)"
`;
}

/**
 * User bootstrap script fragment. The script is base64-embedded so its content
 * (newlines, quotes, heredoc delimiters) cannot break the surrounding cloud-init
 * bootstrap. It runs once, as root, AFTER the agent is healthy, fully isolated:
 * a non-zero exit is logged but never aborts provisioning.
 */
export function renderUserSetup({ setupScript }) {
  const b64 = Buffer.from(String(setupScript), "utf8").toString("base64");
  return `
echo "[mission-control] running user setup script"
cat >/opt/mission-control-agent/setup.b64 <<'MC_SETUP_B64'
${b64}
MC_SETUP_B64
if base64 -d /opt/mission-control-agent/setup.b64 > /opt/mission-control-agent/setup.sh 2>/dev/null; then
  chmod 0755 /opt/mission-control-agent/setup.sh || true
  ( bash /opt/mission-control-agent/setup.sh ) >/var/log/mission-control-setup.log 2>&1 \\
    && echo "[mission-control] user setup script completed" \\
    || echo "[mission-control] WARNING: user setup script exited non-zero (see /var/log/mission-control-setup.log)"
else
  echo "[mission-control] WARNING: could not decode user setup script; skipping"
fi
`;
}

/**
 * Idle auto-stop watchdog fragment. Installs a systemd timer that fires every
 * minute and stops the instance (OS shutdown → EC2 'stop' for EBS-backed) once
 * the agent's activity heartbeat is older than the idle window. The check is a
 * no-op until the agent has written the activity file at least once, so a VM
 * that never finished provisioning is not stopped out from under debugging.
 */
export function renderIdleWatchdog({ idleSeconds, activityFile }) {
  return `
install -d -m 0755 /usr/local/lib
cat >/usr/local/lib/mc-idle-check.sh <<'MC_IDLE_CHECK'
#!/usr/bin/env bash
set -uo pipefail
FILE="\${MC_ACTIVITY_FILE:-${activityFile}}"
IDLE_SECONDS="\${MC_IDLE_SECONDS:-${idleSeconds}}"
# Agent hasn't reported activity yet (still provisioning / down) — do nothing.
[ -f "$FILE" ] || exit 0
now=$(date +%s)
last=$(stat -c %Y "$FILE" 2>/dev/null || echo "$now")
idle=$(( now - last ))
if [ "$idle" -ge "$IDLE_SECONDS" ]; then
  echo "[mission-control] idle \${idle}s >= \${IDLE_SECONDS}s; stopping instance"
  /sbin/shutdown -h now "mission-control idle auto-stop" || systemctl poweroff
fi
MC_IDLE_CHECK
chmod 0755 /usr/local/lib/mc-idle-check.sh

cat >/etc/systemd/system/mission-control-idle.service <<'MC_IDLE_SERVICE'
[Unit]
Description=Mission Control idle auto-stop check

[Service]
Type=oneshot
Environment=MC_ACTIVITY_FILE=${activityFile}
Environment=MC_IDLE_SECONDS=${idleSeconds}
ExecStart=/usr/bin/env bash /usr/local/lib/mc-idle-check.sh
MC_IDLE_SERVICE

cat >/etc/systemd/system/mission-control-idle.timer <<'MC_IDLE_TIMER'
[Unit]
Description=Run the Mission Control idle auto-stop check every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=15s

[Install]
WantedBy=timers.target
MC_IDLE_TIMER

systemctl daemon-reload
systemctl enable --now mission-control-idle.timer
`;
}

/**
 * Cloud-init fragment that runs a dependency-free TLS terminator in front of the
 * loopback-only agent. It is a raw TCP relay (TLS in, plaintext to 127.0.0.1:agent),
 * so it transparently carries both the /health probe and the WebSocket upgrade.
 * The cert is self-signed; the desktop client pins it (it is not browser-facing).
 */
export function renderTlsSidecar({ tlsPort = AGENT_TLS_PORT, agentPort = AGENT_PORT } = {}) {
  return `
install -d -m 0750 /etc/mc-tls
if [ ! -s /etc/mc-tls/tls.crt ] || [ ! -s /etc/mc-tls/tls.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \\
    -subj "/CN=mission-control-agent" \\
    -keyout /etc/mc-tls/tls.key -out /etc/mc-tls/tls.crt
fi
chmod 0640 /etc/mc-tls/tls.key
chmod 0644 /etc/mc-tls/tls.crt

install -d -m 0755 /usr/local/lib
cat >/usr/local/lib/mc-tls-proxy.mjs <<'MC_TLS_PROXY'
import { createServer } from "node:tls";
import { connect } from "node:net";
import { readFileSync } from "node:fs";

const tlsPort = Number(process.env.MC_TLS_PORT || ${tlsPort});
const upstreamPort = Number(process.env.MC_TLS_UPSTREAM_PORT || ${agentPort});
const server = createServer(
  {
    cert: readFileSync(process.env.MC_TLS_CERT || "/etc/mc-tls/tls.crt"),
    key: readFileSync(process.env.MC_TLS_KEY || "/etc/mc-tls/tls.key"),
  },
  (downstream) => {
    const upstream = connect(upstreamPort, "127.0.0.1");
    const bail = () => {
      downstream.destroy();
      upstream.destroy();
    };
    downstream.on("error", bail);
    upstream.on("error", bail);
    downstream.pipe(upstream);
    upstream.pipe(downstream);
  },
);
server.on("error", (err) => {
  console.error("mc-tls-proxy error:", err);
  process.exit(1);
});
server.listen(tlsPort, "0.0.0.0", () => {
  console.log(\`mc-tls-proxy listening on \${tlsPort} -> 127.0.0.1:\${upstreamPort}\`);
});
MC_TLS_PROXY

cat >/etc/systemd/system/mission-control-tls.service <<'MC_TLS_SERVICE'
[Unit]
Description=Mission Control TLS sidecar
After=network-online.target mission-control-agent.service
Wants=network-online.target

[Service]
Type=simple
# Runs as root to bind the privileged TLS port; only forwards to the loopback agent.
ExecStart=/usr/bin/env node /usr/local/lib/mc-tls-proxy.mjs
Environment=MC_TLS_PORT=${tlsPort}
Environment=MC_TLS_UPSTREAM_PORT=${agentPort}
Environment=MC_TLS_CERT=/etc/mc-tls/tls.crt
Environment=MC_TLS_KEY=/etc/mc-tls/tls.key
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
MC_TLS_SERVICE

systemctl daemon-reload
systemctl enable --now mission-control-tls
`;
}

export function normalizeGitAuthMode(value) {
  const v = String(value ?? "").trim();
  return v === "copy-host" || v === "generate" ? v : "none";
}

export function decodeSetupScript(b64) {
  const raw = String(b64 ?? "").trim();
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function writeTempUserData(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-remote-vm-"));
  const file = path.join(dir, "user-data.sh");
  fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
  return { dir, file };
}

export function buildAwsRunInstancesArgs(opts, { imageId, securityGroupId, userDataFile }) {
  const tagSpecifications = JSON.stringify([
    {
      ResourceType: "instance",
      Tags: [
        { Key: "Name", Value: opts.name },
        { Key: "MissionControl", Value: "remote-vm" },
      ],
    },
    {
      ResourceType: "volume",
      Tags: [
        { Key: "Name", Value: opts.name },
        { Key: "MissionControl", Value: "remote-vm" },
      ],
    },
  ]);
  const args = [
    "ec2",
    "run-instances",
    "--image-id",
    imageId,
    "--instance-type",
    opts.size,
    "--count",
    "1",
    "--security-group-ids",
    securityGroupId,
    "--user-data",
    `file://${userDataFile}`,
    "--tag-specifications",
    tagSpecifications,
  ];
  if (opts.keyName) args.push("--key-name", opts.keyName);
  if (opts.subnetId) args.push("--subnet-id", opts.subnetId, "--associate-public-ip-address");
  return args;
}

export function buildDoctlDropletCreateArgs(opts, { userDataFile }) {
  const args = [
    "compute",
    "droplet",
    "create",
    opts.name,
    "--size",
    opts.size,
    "--image",
    opts.image,
    "--region",
    opts.region,
    "--user-data-file",
    userDataFile,
    "--tag-names",
    "mission-control,mission-control-remote-vm",
    "--format",
    "ID,Name,PublicIPv4,Status",
    "--wait",
  ];
  if (opts.sshKey) args.push("--ssh-keys", opts.sshKey);
  if (opts.enableMonitoring) args.push("--enable-monitoring");
  return args;
}

export function buildAwsInstanceLifecycleArgs(action, instanceId) {
  return ["ec2", action, "--instance-ids", instanceId];
}

export function buildDoctlDropletActionArgs(action, dropletId) {
  return ["compute", "droplet-action", action, String(dropletId), "--wait"];
}

export function buildSshArgs({ host, user, identityFile, localPort, remoteCommand }) {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ServerAliveInterval=30",
  ];
  if (identityFile) args.push("-i", expandHome(identityFile));
  if (localPort) {
    args.push("-o", "ExitOnForwardFailure=yes", "-N", "-L", `127.0.0.1:${localPort}:127.0.0.1:${AGENT_PORT}`);
  }
  args.push(`${user}@${host}`);
  if (remoteCommand) args.push(remoteCommand);
  return args;
}

export function createRemoteConfig(input) {
  const accessMode = input.accessMode ?? "direct";
  const tls = input.tls ?? false;
  const agentPort = input.agentPort ?? (tls ? AGENT_TLS_PORT : AGENT_PORT);
  const scheme = tls ? "wss" : "ws";
  const agentUrl =
    input.agentUrl ??
    (accessMode === "ssh-tunnel"
      ? `ws://localhost:${input.localPort}/`
      : `${scheme}://${input.publicIp}:${agentPort}/`);
  return {
    version: REMOTE_CONFIG_VERSION,
    agentUrl,
    accessMode,
    tls,
    // Plaintext-over-public is only allowed when we are NOT terminating TLS.
    // Providers that ride a real public-CA TLS edge (e.g. Railway over wss://)
    // pass `allowPlaintextPublic: false` explicitly so the wss URL isn't flagged.
    allowPlaintextPublic: input.allowPlaintextPublic ?? (!tls && accessMode === "direct"),
    // Self-signed cert (PEM) the desktop client pins; captured at deploy time.
    agentCa: input.agentCa ?? null,
    agentCertSha256: input.agentCertSha256 ?? null,
    provider: input.provider,
    providerId: input.providerId,
    providerName: input.providerName,
    name: input.name,
    region: input.region,
    size: input.size,
    image: input.image,
    publicIp: input.publicIp,
    sshUser: input.sshUser,
    identityFile: input.identityFile || null,
    localPort: input.localPort ?? null,
    agentPort,
    agentBindHost: input.agentBindHost ?? (tls ? "127.0.0.1" : "0.0.0.0"),
    installMode: "host",
    runtimeUser: "workspace",
    status: input.status,
    statusMessage: input.statusMessage || null,
    cloud: input.cloud ?? {},
    projectId: input.projectId ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function ensureRemoteVmSchema(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sandboxes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'remote-vm',
      color TEXT,
      image_tag TEXT,
      dockerfile_path TEXT,
      build_args TEXT,
      git_auth_mode TEXT NOT NULL DEFAULT 'none',
      copy_agent_creds INTEGER NOT NULL DEFAULT 0,
      declared_ports TEXT,
      env TEXT,
      host_agent_port INTEGER,
      port_map TEXT,
      pairing_token TEXT,
      remote_config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  ensureColumn(db, "sandboxes", "name", "TEXT NOT NULL DEFAULT 'Sandbox'");
  ensureColumn(db, "sandboxes", "kind", "TEXT NOT NULL DEFAULT 'remote-vm'");
  ensureColumn(db, "sandboxes", "color", "TEXT");
  ensureColumn(db, "sandboxes", "image_tag", "TEXT");
  ensureColumn(db, "sandboxes", "dockerfile_path", "TEXT");
  ensureColumn(db, "sandboxes", "build_args", "TEXT");
  ensureColumn(db, "sandboxes", "git_auth_mode", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "sandboxes", "copy_agent_creds", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sandboxes", "declared_ports", "TEXT");
  ensureColumn(db, "sandboxes", "env", "TEXT");
  ensureColumn(db, "sandboxes", "host_agent_port", "INTEGER");
  ensureColumn(db, "sandboxes", "port_map", "TEXT");
  ensureColumn(db, "sandboxes", "pairing_token", "TEXT");
  ensureColumn(db, "sandboxes", "remote_config", "TEXT");
  ensureColumn(db, "sandboxes", "created_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sandboxes", "updated_at", "INTEGER NOT NULL DEFAULT 0");
}

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
  if (cols.some((col) => col.name === column)) return;
  db.exec(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${ddl}`);
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function electronBetterSqliteNativeBinding() {
  if (!process.versions.electron) return undefined;
  const betterSqlitePackageJson = requireFromHere.resolve("better-sqlite3/package.json");
  const betterSqliteRoot = path.dirname(betterSqlitePackageJson);
  const binding = path.join(
    betterSqliteRoot,
    "bin",
    `${process.platform}-${process.arch}-${process.versions.modules}`,
    "better-sqlite3.node",
  );
  if (fs.existsSync(binding)) return binding;
  throw new CliError(
    "Electron better-sqlite3 native binding is missing. Restart Mission Control after running pnpm native:electron.",
  );
}

function openMissionControlDb(userDataDir = resolveUserDataDir()) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, "missioncontrol.db");
  const nativeBinding = electronBetterSqliteNativeBinding();
  const db = nativeBinding ? new Database(dbPath, { nativeBinding }) : new Database(dbPath);
  ensureRemoteVmSchema(db);
  return db;
}

export function insertRemoteVmSandbox(
  db,
  { id, name, apiKey, remoteConfig, activate = false, gitAuthMode = "none", copyAgentCreds = false },
) {
  const now = remoteConfig.createdAt ?? Date.now();
  const config = { ...remoteConfig, createdAt: now, updatedAt: now };
  const mode = gitAuthMode === "copy-host" || gitAuthMode === "generate" ? gitAuthMode : "none";
  db.prepare(
    `INSERT INTO sandboxes (
      id, name, kind, color, image_tag, dockerfile_path, build_args, git_auth_mode,
      copy_agent_creds, declared_ports, env, host_agent_port, port_map, pairing_token, remote_config,
      created_at, updated_at
    ) VALUES (?, ?, 'remote-vm', NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
  ).run(id, name, mode, copyAgentCreds ? 1 : 0, apiKey, JSON.stringify(config), now, now);
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(
    SANDBOXES_ENABLED_KEY,
    "true",
  );
  if (activate) {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(
      ACTIVE_SCOPE_KEY,
      id,
    );
  }
}

export function updateRemoteVmStatus(db, id, status, statusMessage = null, patch = {}, options = {}) {
  const row = db.prepare("SELECT remote_config FROM sandboxes WHERE id = ?").get(id);
  if (!row?.remote_config) return;
  let config;
  try {
    config = JSON.parse(row.remote_config);
  } catch {
    config = {};
  }
  const next = {
    ...config,
    ...patch,
    status,
    statusMessage,
    updatedAt: Date.now(),
  };
  const serialized = JSON.stringify(next);
  const result =
    typeof options.expectedRemoteConfig === "string"
      ? db
          .prepare("UPDATE sandboxes SET remote_config = ?, updated_at = ? WHERE id = ? AND remote_config = ?")
          .run(serialized, next.updatedAt, id, options.expectedRemoteConfig)
      : db
          .prepare("UPDATE sandboxes SET remote_config = ?, updated_at = ? WHERE id = ?")
          .run(serialized, next.updatedAt, id);
  return result.changes > 0;
}

function readSandbox(db, id) {
  const row = db
    .prepare("SELECT id, name, kind, pairing_token, remote_config, created_at, updated_at FROM sandboxes WHERE id = ?")
    .get(id);
  if (!row) return null;
  let remoteConfig = null;
  if (row.remote_config) {
    try {
      remoteConfig = JSON.parse(row.remote_config);
    } catch {
      remoteConfig = null;
    }
  }
  return { ...row, remoteConfig };
}

function listRemoteVmSandboxes(db) {
  return db
    .prepare("SELECT id, name, kind, pairing_token, remote_config, created_at, updated_at FROM sandboxes WHERE kind = 'remote-vm' ORDER BY created_at DESC")
    .all()
    .map((row) => {
      let remoteConfig = null;
      if (row.remote_config) {
        try {
          remoteConfig = JSON.parse(row.remote_config);
        } catch {
          remoteConfig = null;
        }
      }
      return { ...row, remoteConfig };
    });
}

function chooseLocalPort(db, requested) {
  if (requested) return requested;
  const used = new Set(
    listRemoteVmSandboxes(db)
      .map((row) => row.remoteConfig?.localPort)
      .filter((port) => Number.isInteger(port)),
  );
  let candidate = DEFAULT_LOCAL_TUNNEL_PORT;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function accessCidrFor(flags) {
  const cidr = strFlag(flags, "access-cidr") || strFlag(flags, "ssh-cidr");
  if (cidr) return normalizeCidr(cidr);
  try {
    return await detectPublicIpCidr();
  } catch (err) {
    throw new CliError(
      `Could not detect your public IP for the agent firewall rule. Re-run with --access-cidr <your-ip>/32. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function ensureAwsSecurityGroup(opts, accessCidr, agentPort = AGENT_PORT) {
  let vpcId = "";
  let securityGroupId = opts.securityGroupId;
  if (!securityGroupId) {
    if (opts.subnetId) {
      const subnets = awsJson(opts, ["ec2", "describe-subnets", "--subnet-ids", opts.subnetId]);
      vpcId = subnets.Subnets?.[0]?.VpcId ?? "";
    } else {
      const vpcs = awsJson(opts, [
        "ec2",
        "describe-vpcs",
        "--filters",
        "Name=isDefault,Values=true",
      ]);
      vpcId = vpcs.Vpcs?.[0]?.VpcId ?? "";
    }
    if (!vpcId) {
      throw new CliError(
        "Could not find a VPC for the EC2 instance. Provide --subnet-id or --security-group-id.",
      );
    }

    const existing = awsJson(opts, [
      "ec2",
      "describe-security-groups",
      "--filters",
      `Name=group-name,Values=${DEFAULT_AWS_SECURITY_GROUP}`,
      `Name=vpc-id,Values=${vpcId}`,
    ]);
    securityGroupId = existing.SecurityGroups?.[0]?.GroupId ?? "";
    if (!securityGroupId) {
      const created = awsJson(opts, [
        "ec2",
        "create-security-group",
        "--group-name",
        DEFAULT_AWS_SECURITY_GROUP,
        "--description",
        "Mission Control remote VM agent access",
        "--vpc-id",
        vpcId,
      ]);
      securityGroupId = created.GroupId;
    }
  }

  authorizeAwsIngress(opts, securityGroupId, agentPort, accessCidr, "Mission Control agent access");
  if (opts.keyName) {
    authorizeAwsIngress(opts, securityGroupId, 22, accessCidr, "Mission Control optional SSH access");
  }

  return { securityGroupId, managed: !opts.securityGroupId, vpcId };
}

function authorizeAwsIngress(opts, securityGroupId, port, cidr, description) {
  const permission = JSON.stringify([
    {
      IpProtocol: "tcp",
      FromPort: port,
      ToPort: port,
      IpRanges: [{ CidrIp: cidr, Description: description }],
    },
  ]);
  const ingress = run(
    "aws",
    awsArgs(opts, [
      "ec2",
      "authorize-security-group-ingress",
      "--group-id",
      securityGroupId,
      "--ip-permissions",
      permission,
    ]),
  );
  if (ingress.code !== 0 && !ingress.stderr.includes("InvalidPermission.Duplicate")) {
    throw new CliError(
      `Failed to authorize TCP/${port} ingress on ${securityGroupId}: ${ingress.stderr.trim()}`,
    );
  }
}

function preflightAws(opts) {
  assertCommand("aws", "Install AWS CLI v2 and run aws configure or set AWS_PROFILE/AWS credentials.");
  try {
    awsJson(opts, ["sts", "get-caller-identity"]);
  } catch (err) {
    throw new CliError(`AWS credentials are not usable. ${err instanceof Error ? err.message : String(err)}`);
  }
  if (opts.keyName) awsJson(opts, ["ec2", "describe-key-pairs", "--key-names", opts.keyName]);
  awsJson(opts, ["ec2", "describe-instance-types", "--instance-types", opts.size]);
}

function preflightDoctl(opts) {
  assertCommand("doctl", "Install doctl and run doctl auth init or set DIGITALOCEAN_ACCESS_TOKEN.");
  try {
    doctlJson(["account", "get"]);
  } catch (err) {
    throw new CliError(`DigitalOcean credentials are not usable. ${err instanceof Error ? err.message : String(err)}`);
  }

  const sizes = doctlJson(["compute", "size", "list"]);
  if (Array.isArray(sizes) && sizes.length > 0 && !sizes.some((s) => s.slug === opts.size || s.Slug === opts.size)) {
    throw new CliError(`DigitalOcean size "${opts.size}" was not found. Run doctl compute size list.`);
  }
  const regions = doctlJson(["compute", "region", "list"]);
  if (Array.isArray(regions) && regions.length > 0 && !regions.some((r) => r.slug === opts.region || r.Slug === opts.region)) {
    throw new CliError(`DigitalOcean region "${opts.region}" was not found. Run doctl compute region list.`);
  }
}

function resolveDoSshKey(value) {
  const keys = doctlJson(["compute", "ssh-key", "list"]);
  if (!Array.isArray(keys)) return value;
  const exact = keys.find((key) => {
    return key.name === value || key.Name === value || String(key.id ?? key.ID) === value || key.fingerprint === value || key.FingerPrint === value;
  });
  if (!exact) {
    throw new CliError(`DigitalOcean SSH key "${value}" was not found. Run doctl compute ssh-key list.`);
  }
  return String(exact.id ?? exact.ID ?? exact.fingerprint ?? exact.FingerPrint ?? value);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function derToPem(der) {
  const b64 = der.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

/**
 * Probe the agent's /health endpoint. Returns the reason on failure so the wait
 * loop can explain itself, and (over TLS) the peer certificate so the deploy can
 * pin it on the client.
 */
function checkAgentHealth({ host, port, tls = false }) {
  return new Promise((resolve) => {
    const mod = tls ? https : http;
    const options = { host, port, path: "/health", timeout: 8_000 };
    // Self-signed on the VM by design — the desktop client pins this exact cert.
    if (tls) options.rejectUnauthorized = false;
    const req = mod.get(options, (res) => {
      const ok = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
      let cert = null;
      if (ok && tls && typeof res.socket.getPeerCertificate === "function") {
        const peer = res.socket.getPeerCertificate(true);
        if (peer?.raw) {
          cert = { pem: derToPem(peer.raw), sha256: peer.fingerprint256 || null };
        }
      }
      res.resume();
      resolve({ ok, reason: ok ? null : `HTTP ${res.statusCode}`, cert });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: "timeout", cert: null });
    });
    req.on("error", (err) => resolve({ ok: false, reason: err.code || err.message, cert: null }));
  });
}

/**
 * Poll the agent until healthy. Resolves with the pinned cert (TLS) or null.
 * Surfaces the last failure reason periodically rather than emitting bare dots.
 */
async function waitForRemoteAgentHttp({ host, port, tls = false, timeoutSec }) {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastReason = "no response yet";
  let attempts = 0;
  while (Date.now() < deadline) {
    const result = await checkAgentHealth({ host, port, tls });
    if (result.ok) {
      if (attempts > 0) process.stdout.write("\n");
      return result.cert;
    }
    if (result.reason && result.reason !== lastReason) {
      lastReason = result.reason;
      process.stdout.write(`\n[remote-vm] agent not ready yet (${lastReason}) `);
    } else {
      process.stdout.write(".");
    }
    attempts += 1;
    await sleep(10_000);
  }
  process.stdout.write("\n");
  throw new CliError(
    `Timed out waiting for the remote agent after ${timeoutSec}s (last error: ${lastReason}). ` +
      `Verify TCP/${port} is allowed from your access CIDR and that the agent/TLS services are running on the VM.`,
  );
}

function fetchAwsConsoleOutput(opts, instanceId) {
  const result = run(
    "aws",
    awsArgs(opts, ["ec2", "get-console-output", "--instance-id", instanceId, "--output", "text"]),
  );
  if (result.code !== 0) return null;
  const text = (result.stdout || "").trim();
  return text || null;
}

function createDigitalOceanFirewall(dropletId, accessCidr, { enableSsh = false } = {}) {
  const name = `mc-remote-vm-${dropletId}`;
  const inboundRules = [`protocol:tcp,ports:${AGENT_PORT},address:${accessCidr}`];
  if (enableSsh) inboundRules.push(`protocol:tcp,ports:22,address:${accessCidr}`);
  const result = run("doctl", [
    "compute",
    "firewall",
    "create",
    "--name",
    name,
    "--droplet-ids",
    String(dropletId),
    "--inbound-rules",
    inboundRules.join(" "),
    "--outbound-rules",
    "protocol:tcp,ports:all,address:0.0.0.0/0 protocol:udp,ports:all,address:0.0.0.0/0 protocol:icmp,address:0.0.0.0/0",
    "--format",
    "ID,Name,Status",
    "--output",
    "json",
  ]);
  if (result.code !== 0) {
    throw new CliError(`Failed to create DigitalOcean firewall: ${result.stderr.trim()}`);
  }
  const parsed = parseJsonOutput(result.stdout, "doctl firewall create");
  return firstItem(parsed)?.ID ?? firstItem(parsed)?.id ?? null;
}

// --- Railway -----------------------------------------------------------------
// The Railway CLI keeps project state per working directory, so every deploy runs
// its commands inside a throwaway temp dir that is linked to the shared project.

function railwayRun(args, { cwd, allowFail = false } = {}) {
  // CI=1 / NO_COLOR keep the CLI from prompting or emitting ANSI in piped mode.
  const env = { ...process.env, CI: "1", NO_COLOR: "1" };
  // Stale CI tokens in the shell override `railway login` sessions and often
  // lack the scopes needed for deploy mutations.
  if (!process.env.MC_RAILWAY_API_TOKEN) {
    delete env.RAILWAY_TOKEN;
    delete env.RAILWAY_API_TOKEN;
  }
  const result = run("railway", args, { cwd, env, timeout: 10 * 60 * 1000 });
  if (!allowFail && result.code !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "command failed").trim();
    throw new CliError(`railway ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function railwayJson(args, opts = {}) {
  const result = railwayRun([...args, "--json"], opts);
  return extractJsonFromCliOutput(result.stdout, `railway ${args[0] ?? ""}`);
}

function resolveRailwayWorkspaceId() {
  const preferred = process.env.RAILWAY_WORKSPACE || process.env.RAILWAY_TEAM || "";
  const whoami = railwayJson(["whoami"]);
  return selectRailwayWorkspaceId(whoami.workspaces, preferred);
}

function preflightRailway() {
  assertCommand("railway", "Install the Railway CLI (https://docs.railway.com/cli) and run `railway login`.");
  assertCommand("git", "Install Git so Mission Control can fetch the agent repository for Railway deploy.");
  const who = railwayRun(["whoami"], { allowFail: true });
  if (who.code !== 0) {
    throw new CliError(
      "Railway CLI is not logged in. Run `railway login` in your terminal so Mission Control can deploy, then retry.",
    );
  }
}

// Walk arbitrary CLI JSON collecting { id, name } pairs that look like Railway
// resources, so project lookup survives shape differences across CLI versions.
function deepCollectNamed(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const item of node) deepCollectNamed(item, acc);
    return acc;
  }
  const id = node.id ?? node.projectId;
  const { name } = node;
  if (typeof id === "string" && typeof name === "string" && /^[0-9a-f-]{16,}$/i.test(id)) {
    acc.push({ id, name });
  }
  for (const value of Object.values(node)) deepCollectNamed(value, acc);
  return acc;
}

function findRailwayProjectId(name) {
  let parsed;
  try {
    parsed = railwayJson(["list"]);
  } catch {
    return null;
  }
  const match = deepCollectNamed(parsed).find(
    (entry) => entry.name.trim().toLowerCase() === name.toLowerCase(),
  );
  return match?.id ?? null;
}

// Reuse the shared "mission-control" project when present; otherwise create it.
// Either path leaves the temp dir linked to the project for follow-up commands.
function ensureRailwayProject(cwd, workspaceId) {
  const existingId = findRailwayProjectId(MC_RAILWAY_PROJECT_NAME);
  if (existingId) {
    railwayRun(
      ["link", "--project", existingId, "--environment", "production", "--workspace", workspaceId],
      { cwd },
    );
    console.log(`[remote-vm] linked existing Railway project ${MC_RAILWAY_PROJECT_NAME} (${existingId})`);
    return existingId;
  }
  const created = railwayJson(
    ["init", "--name", MC_RAILWAY_PROJECT_NAME, "--workspace", workspaceId],
    { cwd },
  );
  const projectId =
    deepCollectNamed(created).find(
      (entry) => entry.name.trim().toLowerCase() === MC_RAILWAY_PROJECT_NAME.toLowerCase(),
    )?.id ??
    deepCollectNamed(created)[0]?.id ??
    findRailwayProjectId(MC_RAILWAY_PROJECT_NAME);
  console.log(`[remote-vm] created Railway project ${MC_RAILWAY_PROJECT_NAME}${projectId ? ` (${projectId})` : ""}`);
  return projectId;
}

function cloneAgentRepo(destDir) {
  assertCommand("git", "Install Git so Mission Control can fetch the agent repository for Railway deploy.");
  if (fs.existsSync(destDir)) {
    throw new CliError(`Refusing to clone into existing path: ${destDir}`);
  }
  console.log(`[remote-vm] cloning ${MC_AGENT_REPO} for Railway build`);
  runChecked("git", ["clone", "--depth", "1", MC_AGENT_REPO_URL, destDir], {
    timeout: 10 * 60 * 1000,
  });
}

function linkRailwayService(cwd, { projectId, workspaceId, serviceName }) {
  const args = ["link", "--environment", "production", "--service", serviceName];
  if (projectId) args.push("--project", projectId);
  if (workspaceId) args.push("--workspace", workspaceId);
  railwayRun(args, { cwd });
}

function readRailwayUserToken() {
  const configPath = path.join(os.homedir(), ".railway", "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config?.user?.token || config?.user?.accessToken || null;
  } catch {
    return null;
  }
}

export function isRailwayNoDeploymentsMessage(output) {
  return /no deployments found/i.test(output) || /service\s+['"]?[^'"\s]+['"]?\s+not found/i.test(output);
}

function findRailwayServiceRecord(cwd, serviceName) {
  const result = railwayRun(["service", "list", "--json"], { cwd, allowFail: true });
  if ((result.code ?? 1) !== 0) return null;
  try {
    const services = extractJsonFromCliOutput(result.stdout, "railway service list");
    if (!Array.isArray(services)) return null;
    return (
      services.find((service) => service?.name === serviceName || service?.id === serviceName) ?? null
    );
  } catch {
    return null;
  }
}

function railwayDownOptional(cwd, serviceName) {
  const result = railwayRun(["down", "--service", String(serviceName), "--yes"], { cwd, allowFail: true });
  const output = railwayCommandOutput(result);
  if ((result.code ?? 1) === 0) {
    console.log(`[remote-vm] removed Railway deployment for service ${serviceName}`);
    return;
  }
  if (isRailwayNoDeploymentsMessage(output)) {
    console.log(`[remote-vm] Railway service ${serviceName} has no deployment to remove`);
    return;
  }
  throw new CliError(`railway down --service ${serviceName} --yes failed: ${output.slice(0, 800)}`);
}

function deleteRailwayVolumesForService(cwd, serviceName, serviceRecord) {
  const deleted = new Set();
  for (const vol of serviceRecord?.volumes ?? []) {
    const volId = vol?.id ?? vol?.volumeId ?? vol?.name;
    if (!volId || deleted.has(volId)) continue;
    deleted.add(volId);
    railwayRun(["volume", "delete", "--volume", String(volId), "--yes"], { cwd, allowFail: true });
  }
  const fallbackName = `${serviceName}-volume`;
  if (!deleted.has(fallbackName)) {
    railwayRun(["volume", "delete", "--volume", fallbackName, "--yes"], { cwd, allowFail: true });
  }
}

async function deleteRailwayServiceGraphql(serviceId) {
  const token =
    process.env.MC_RAILWAY_API_TOKEN || process.env.RAILWAY_API_TOKEN || readRailwayUserToken();
  if (!token) {
    console.log("[remote-vm] skipping Railway service delete (no API token; run `railway login`)");
    return;
  }
  const response = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "mutation serviceDelete($id: String!) { serviceDelete(id: $id) }",
      variables: { id: serviceId },
    }),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    const detail = body.errors?.[0]?.message || `HTTP ${response.status}`;
    console.log(`[remote-vm] Railway serviceDelete skipped: ${detail}`);
    return;
  }
  console.log(`[remote-vm] deleted Railway service ${serviceId}`);
}

async function cleanupRailwaySandbox(cfg) {
  preflightRailway();
  const serviceName = String(cfg.cloud?.serviceName || cfg.providerId);
  const projectId = cfg.cloud?.projectId ? String(cfg.cloud.projectId) : null;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mc-railway-"));
  try {
    let workspaceId = null;
    try {
      workspaceId = resolveRailwayWorkspaceId();
    } catch {
      // Linking by project id alone still works for many accounts.
    }
    if (projectId) {
      const linkArgs = ["link", "--project", projectId, "--environment", "production"];
      if (workspaceId) linkArgs.push("--workspace", workspaceId);
      railwayRun(linkArgs, { cwd: work, allowFail: true });
    }
    railwayDownOptional(work, serviceName);
    const serviceRecord = findRailwayServiceRecord(work, serviceName);
    deleteRailwayVolumesForService(work, serviceName, serviceRecord);
    if (serviceRecord?.id) {
      await deleteRailwayServiceGraphql(serviceRecord.id);
    } else {
      console.log(`[remote-vm] Railway service ${serviceName} not found in project (may already be deleted)`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Railway service names must be unique within the project and URL-safe; derive a
// slug from the sandbox name plus a short suffix so repeat names don't collide.
export function railwaySafeServiceName(name) {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "agent";
  return `${slug}-${randomBytes(2).toString("hex")}`;
}

function railwayHostFromString(value) {
  if (typeof value !== "string") return null;
  const host = value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  return /\.railway\.app$/i.test(host) ? host : null;
}

export function deepFindRailwayHost(node) {
  const direct = railwayHostFromString(node);
  if (direct) return direct;
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindRailwayHost(item);
      if (found) return found;
    }
    return null;
  }
  for (const key of ["domain", "serviceDomain", "host", "url"]) {
    const found = deepFindRailwayHost(node[key]);
    if (found) return found;
  }
  for (const value of Object.values(node)) {
    const found = deepFindRailwayHost(value);
    if (found) return found;
  }
  return null;
}

const RAILWAY_AGENT_CONTAINER_PORT = 9333;

function parseRailwayDomainFromCliOutput(stdout, stderr = "") {
  let host = null;
  try {
    host = deepFindRailwayHost(extractJsonFromCliOutput(stdout, "railway domain"));
  } catch {
    host = null;
  }
  if (!host) {
    const raw = `${stdout}\n${stderr}`;
    const match = raw.match(/([a-z0-9-]+\.up\.railway\.app)/i) || raw.match(/([a-z0-9-]+\.railway\.app)/i);
    host = match ? match[1] : null;
  }
  return host;
}

function existingRailwayDomainFromServiceRecord(serviceRecord) {
  if (!serviceRecord || typeof serviceRecord !== "object") return null;
  const domains = serviceRecord.domains ?? serviceRecord.serviceDomains ?? serviceRecord.networking?.domains;
  if (Array.isArray(domains)) {
    for (const entry of domains) {
      const host = deepFindRailwayHost(entry);
      if (host) return host;
    }
  }
  return deepFindRailwayHost(serviceRecord);
}

async function railwayGraphql(query, variables = {}) {
  const token =
    process.env.MC_RAILWAY_API_TOKEN || process.env.RAILWAY_API_TOKEN || readRailwayUserToken();
  if (!token) {
    throw new CliError("Railway API token is required for domain creation. Run `railway login` and retry.");
  }
  const response = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    const detail = body.errors?.[0]?.message || `HTTP ${response.status}`;
    throw new CliError(`Railway API error: ${detail}`);
  }
  return body.data;
}

async function resolveRailwayProductionEnvironmentId(projectId) {
  const data = await railwayGraphql(
    `query projectEnvironments($id: String!) {
      project(id: $id) {
        environments { edges { node { id name } } }
      }
    }`,
    { id: projectId },
  );
  const edges = data?.project?.environments?.edges ?? [];
  const production =
    edges.find((edge) => String(edge?.node?.name ?? "").toLowerCase() === "production")?.node ??
    edges[0]?.node;
  if (!production?.id) {
    throw new CliError("Could not resolve the Railway production environment id for domain creation.");
  }
  return production.id;
}

async function createRailwayDomainGraphql({ projectId, serviceId, port }) {
  const environmentId = await resolveRailwayProductionEnvironmentId(projectId);
  const input = { serviceId, environmentId };
  if (port) input.targetPort = port;
  const data = await railwayGraphql(
    `mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { id domain }
    }`,
    { input },
  );
  const host = railwayHostFromString(data?.serviceDomainCreate?.domain);
  if (!host) {
    throw new CliError("Railway domain API did not return a public hostname.");
  }
  return host;
}

function runRailwayDomainCreate(cwd, serviceName, port, { allowFail = false } = {}) {
  const args = ["domain", "--service", serviceName, "--json"];
  if (port) args.push("-p", String(port));
  return railwayRun(args, { cwd, allowFail });
}

/** Create or reuse a *.up.railway.app domain before deploy; fail loudly if none is available. */
export async function ensureRailwayDomain(cwd, { projectId, workspaceId, serviceName }) {
  linkRailwayService(cwd, { projectId, workspaceId, serviceName });

  const serviceRecord = findRailwayServiceRecord(cwd, serviceName);
  let host = existingRailwayDomainFromServiceRecord(serviceRecord);
  if (host) {
    console.log(`[remote-vm] reusing Railway domain ${host}`);
    return host;
  }

  console.log(`[remote-vm] generating public Railway domain for ${serviceName}`);
  let result = runRailwayDomainCreate(cwd, serviceName, undefined, { allowFail: true });
  host = parseRailwayDomainFromCliOutput(result.stdout, result.stderr);
  if (!host) {
    console.log("[remote-vm] retrying Railway domain creation with container port 9333");
    result = runRailwayDomainCreate(cwd, serviceName, RAILWAY_AGENT_CONTAINER_PORT, { allowFail: true });
    host = parseRailwayDomainFromCliOutput(result.stdout, result.stderr);
  }
  if (!host && serviceRecord?.id) {
    try {
      host = await createRailwayDomainGraphql({
        projectId,
        serviceId: serviceRecord.id,
        port: RAILWAY_AGENT_CONTAINER_PORT,
      });
      console.log(`[remote-vm] created Railway domain via API: ${host}`);
      return host;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new CliError(
        `Could not create a Railway domain for ${serviceName}. CLI: ${railwayCommandOutput(result).slice(0, 400)}. API: ${detail}`,
      );
    }
  }
  if (!host) {
    throw new CliError(
      `Could not determine the Railway domain for ${serviceName}. railway domain output: ${railwayCommandOutput(result).slice(0, 500)}`,
    );
  }
  console.log(`[remote-vm] Railway domain: https://${host}`);
  return host;
}

/** Point the service at mission-control-agent's railway.json (volume + Dockerfile + health check). */
export async function ensureRailwayConfigFile(cwd, { projectId, serviceName }) {
  console.log(`[remote-vm] setting Railway config file to ${MC_RAILWAY_CONFIG_FILE}`);
  const edit = railwayRun(
    [
      "environment",
      "edit",
      "--environment",
      "production",
      "--service-config",
      serviceName,
      "configFile",
      MC_RAILWAY_CONFIG_FILE,
      "--message",
      "Mission Control: set mission-control-agent railway.json",
      "--json",
    ],
    { cwd, allowFail: true },
  );
  if ((edit.code ?? 1) === 0) {
    return;
  }

  const serviceRecord = findRailwayServiceRecord(cwd, serviceName);
  const serviceId = serviceRecord?.id;
  if (!serviceId) {
    throw new CliError(
      `Could not set Railway config file for ${serviceName}. CLI: ${railwayCommandOutput(edit).slice(0, 400)}`,
    );
  }
  const environmentId = await resolveRailwayProductionEnvironmentId(projectId);
  await railwayGraphql(
    `mutation EnvironmentPatchCommit($environmentId: String!, $patch: EnvironmentConfig!, $commitMessage: String) {
      environmentPatchCommit(environmentId: $environmentId, patch: $patch, commitMessage: $commitMessage)
    }`,
    {
      environmentId,
      commitMessage: "Mission Control: set mission-control-agent railway.json",
      patch: {
        services: {
          [serviceId]: { configFile: MC_RAILWAY_CONFIG_FILE },
        },
      },
    },
  );
  console.log("[remote-vm] Railway config file set via API");
}

/** Keep Railway runtime env aligned with the pairing token stored in Mission Control. */
function ensureRailwayApiKey(cwd, serviceName, apiKey) {
  console.log("[remote-vm] setting MC_AGENT_API_KEY on Railway service");
  railwayRun(
    ["variable", "set", `MC_AGENT_API_KEY=${apiKey}`, "-s", serviceName, "--skip-deploys"],
    { cwd },
  );
}

function railwayCommandOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

export function isRailwayDeploymentReady(status) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  return (
    normalized === "SUCCESS" ||
    normalized === "SUCCEEDED" ||
    normalized === "ACTIVE" ||
    normalized === "COMPLETED"
  );
}

export function isRailwayDeploymentFailed(status) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  return normalized === "FAILED" || normalized === "CRASHED" || normalized === "CANCELLED";
}

export function latestRailwayDeploymentStatus(parsed) {
  const deployments = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.deployments)
      ? parsed.deployments
      : parsed?.deployment
        ? [parsed.deployment]
        : [];
  const latest = deployments[0];
  if (!latest || typeof latest !== "object") return null;
  return latest.status ?? latest.state ?? latest.deploymentStatus ?? null;
}

function assertRailwayUpSucceeded(result) {
  const output = railwayCommandOutput(result);
  if (output.includes("Cannot redeploy without a snapshot")) {
    throw new CliError(
      "Railway could not create a deployment snapshot. In the Railway dashboard, open the service → Settings → enable the Metal build environment, then retry deploy.",
    );
  }
  if ((result.code ?? 1) !== 0) {
    throw new CliError(`railway up failed: ${output.slice(0, 800)}`);
  }
}

/** Optional first upload — failures are ignored; the final deploy after domain + API key is authoritative. */
function bootstrapRailwayUpload(sourceDir, serviceName) {
  console.log("[remote-vm] bootstrap upload to Railway (non-fatal; final deploy follows)");
  const result = railwayRun(["up", "--service", serviceName, "--ci"], { cwd: sourceDir, allowFail: true });
  if ((result.code ?? 1) !== 0) {
    const detail = railwayCommandOutput(result).slice(0, 600);
    console.log(`[remote-vm] bootstrap upload exited ${result.code ?? "?"} — continuing: ${detail}`);
    return;
  }
  console.log("[remote-vm] bootstrap upload finished");
}

async function waitForRailwayDeployment(cwd, serviceName, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastStatus = "pending";
  let attempts = 0;
  while (Date.now() < deadline) {
    const result = railwayRun(
      ["deployment", "list", "--service", serviceName, "--limit", "1", "--json"],
      { cwd, allowFail: true },
    );
    try {
      const parsed = extractJsonFromCliOutput(result.stdout, "railway deployment list");
      const status = latestRailwayDeploymentStatus(parsed);
      if (status && isRailwayDeploymentReady(status)) {
        if (attempts > 0) process.stdout.write("\n");
        return status;
      }
      if (status && isRailwayDeploymentFailed(status)) {
        throw new CliError(
          `Railway deployment failed with status ${status}. Inspect build logs with: railway logs --service ${serviceName} --build`,
        );
      }
      if (status && status !== lastStatus) {
        lastStatus = status;
        process.stdout.write(`\n[remote-vm] Railway deployment status: ${status} `);
      } else {
        process.stdout.write(".");
      }
    } catch (err) {
      if (err instanceof CliError) throw err;
      process.stdout.write(".");
    }
    attempts += 1;
    await sleep(15_000);
  }
  process.stdout.write("\n");
  throw new CliError(
    `Timed out waiting for Railway deployment after ${timeoutSec}s (last status: ${lastStatus}). ` +
      `Inspect build logs with: railway logs --service ${serviceName} --build`,
  );
}

function buildRailwayRemoteConfig({
  name,
  serviceName,
  projectId,
  domain = null,
  status = "provisioning",
  statusMessage = null,
  createdAt = Date.now(),
}) {
  const publicIp = domain ?? `${serviceName}.up.railway.app`;
  const agentUrl = `wss://${publicIp}/`;
  return createRemoteConfig({
    provider: "railway",
    providerId: serviceName,
    providerName: "Railway",
    name,
    region: null,
    size: null,
    image: MC_AGENT_REPO,
    publicIp,
    agentUrl,
    agentPort: AGENT_TLS_PORT,
    sshUser: null,
    identityFile: null,
    localPort: null,
    accessMode: "direct",
    tls: false,
    allowPlaintextPublic: false,
    status,
    statusMessage,
    cloud: {
      projectId,
      projectName: MC_RAILWAY_PROJECT_NAME,
      serviceName,
      repo: MC_AGENT_REPO,
      domain,
      volumeMountPath: MC_RAILWAY_VOLUME_MOUNT,
    },
    createdAt,
    updatedAt: Date.now(),
  });
}

async function deployRailway(flags) {
  const name = required(strFlag(flags, "name"), "--name is required.");
  const opts = {
    name,
    waitTimeout: intFlag(flags, "wait-timeout", 900),
    noWait: boolFlag(flags, "no-wait"),
    activate: boolFlag(flags, "activate"),
    json: boolFlag(flags, "json"),
  };
  preflightRailway();
  const workspaceId = resolveRailwayWorkspaceId();
  const db = openMissionControlDb();
  const apiKey = randomSecret();
  const sandboxId = strFlag(flags, "sandbox-id") || newId("sb");
  const serviceName = railwaySafeServiceName(name);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mc-railway-"));
  let sandboxPersisted = false;

  try {
    const projectId = ensureRailwayProject(work, workspaceId);
    if (!projectId) {
      throw new CliError(
        `Could not determine the Railway project id for ${MC_RAILWAY_PROJECT_NAME}. Run \`railway list --json\` and retry.`,
      );
    }

    // `railway add --repo` requires Railway's GitHub App integration and often
    // returns Unauthorized even when `railway login` works. Create an empty
    // service, clone the public agent repo locally, and upload with `railway up`.
    console.log(`[remote-vm] creating Railway service "${serviceName}"`);
    railwayRun(
      [
        "add",
        "--service",
        serviceName,
        "--variables",
        `MC_AGENT_API_KEY=${apiKey}`,
      ],
      { cwd: work },
    );

    linkRailwayService(work, { projectId, workspaceId, serviceName });

    await ensureRailwayConfigFile(work, { projectId, serviceName });

    // mission-control-agent deploy/railway/railway.json sets deploy.requiredMountPath to
    // /home/workspace — the first deploy fails until that volume exists.
    console.log(`[remote-vm] attaching volume at ${MC_RAILWAY_VOLUME_MOUNT}`);
    railwayRun(["volume", "add", "--mount-path", MC_RAILWAY_VOLUME_MOUNT], { cwd: work });

    // Persist immediately so Mission Control keeps the sandbox in the scope list
    // even when a later Railway CLI step fails.
    insertRemoteVmSandbox(db, {
      id: sandboxId,
      name,
      apiKey,
      remoteConfig: buildRailwayRemoteConfig({
        name,
        serviceName,
        projectId,
        statusMessage: "Deploying agent to Railway…",
      }),
      activate: opts.activate,
    });
    sandboxPersisted = true;

    const sourceDir = path.join(work, "agent-source");
    cloneAgentRepo(sourceDir);
    linkRailwayService(sourceDir, { projectId, workspaceId, serviceName });

    const domain = await ensureRailwayDomain(work, { projectId, workspaceId, serviceName });
    const agentUrl = `wss://${domain}/`;
    ensureRailwayApiKey(work, serviceName, apiKey);
    updateRemoteVmStatus(db, sandboxId, "provisioning", "Deploying agent to Railway…", {
      publicIp: domain,
      agentUrl,
      cloud: {
        projectId,
        projectName: MC_RAILWAY_PROJECT_NAME,
        serviceName,
        repo: MC_AGENT_REPO,
        domain,
        volumeMountPath: MC_RAILWAY_VOLUME_MOUNT,
      },
    });

    bootstrapRailwayUpload(sourceDir, serviceName);

    console.log("[remote-vm] final Railway deploy (waiting for this deployment to succeed)");
    assertRailwayUpSucceeded(railwayRun(["up", "--service", serviceName, "--ci"], { cwd: sourceDir }));
    await waitForRailwayDeployment(work, serviceName, opts.waitTimeout);

    if (!opts.noWait) {
      console.log("[remote-vm] waiting for the Railway build and agent health");
      try {
        await waitForRemoteAgentHttp({
          host: domain,
          port: AGENT_TLS_PORT,
          tls: true,
          timeoutSec: opts.waitTimeout,
        });
        updateRemoteVmStatus(db, sandboxId, "ready", null);
      } catch (err) {
        console.error(`[remote-vm] tip: inspect the build with: railway logs --service ${serviceName} --build`);
        updateRemoteVmStatus(db, sandboxId, "provisioning_failed", err instanceof Error ? err.message : String(err));
        throw err;
      }
    }

    printDeployResult({
      sandboxId,
      name,
      provider: "Railway",
      publicIp: domain,
      agentUrl,
      json: opts.json,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (sandboxPersisted) {
      updateRemoteVmStatus(db, sandboxId, "provisioning_failed", message);
    }
    throw err;
  } finally {
    db.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function deployAws(flags) {
  const name = required(strFlag(flags, "name"), "--name is required.");
  const region = required(strFlag(flags, "region", process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || ""), "--region is required.");
  const keyName = strFlag(flags, "key-name");
  const opts = {
    name,
    region,
    keyName,
    profile: strFlag(flags, "profile", process.env.AWS_PROFILE || ""),
    size: strFlag(flags, "size", DEFAULT_AWS_SIZE),
    // Explicit override only; empty means auto-resolve (golden AMI → SSM Ubuntu).
    imageId: strFlag(flags, "image-id"),
    subnetId: strFlag(flags, "subnet-id"),
    securityGroupId: strFlag(flags, "security-group-id"),
    identityFile: strFlag(flags, "identity-file"),
    localPort: intFlag(flags, "local-port", null),
    waitTimeout: intFlag(flags, "wait-timeout", 900),
    noWait: boolFlag(flags, "no-wait"),
    activate: boolFlag(flags, "activate"),
    json: boolFlag(flags, "json"),
  };
  // Copy the user's ~/.ssh keys to the VM (over the agent WS on connect) by
  // default so cloning private repos just works; pass --git-auth-mode none to opt out.
  const gitAuthMode = normalizeGitAuthMode(strFlag(flags, "git-auth-mode", "copy-host"));
  // Push the host's AI-CLI logins (Claude/Codex/Cursor/OpenCode) to the VM on
  // connect so sessions are usable immediately. Opt-in (off unless flagged).
  const copyAgentCreds = boolFlag(flags, "copy-agent-creds");
  // Idle auto-stop window. Default 30 min; 0 disables.
  const idleTimeoutMinutes = intFlag(flags, "idle-timeout", 30);
  const setupScript = decodeSetupScript(strFlag(flags, "setup-script-b64"));
  const projectId = strFlag(flags, "project-id");
  const db = openMissionControlDb();
  preflightAws(opts);
  opts.localPort = opts.keyName ? chooseLocalPort(db, opts.localPort) : null;
  const accessCidr = await accessCidrFor(flags);
  // The agent is reached over HTTPS via an on-VM TLS sidecar on AGENT_TLS_PORT.
  const sg = ensureAwsSecurityGroup(opts, accessCidr, AGENT_TLS_PORT);
  const apiKey = randomSecret();
  const sandboxId = strFlag(flags, "sandbox-id") || newId("sb");

  // Resolve the launch image. Prefer a published golden AMI for this region+arch
  // (owner-verified to defeat AMI squatting) and launch from it with the slim boot
  // user-data; otherwise fall back to the stock Ubuntu base + full-install user-data
  // so provisioning always works, even offline or in an unpublished region.
  const explicitImageId = opts.imageId;
  const noGolden = boolFlag(flags, "no-golden");
  const arch = archForInstanceSize(opts.size);
  let golden = null;
  let manifestSource = "none";
  if (!explicitImageId && !noGolden) {
    const resolved = await fetchGoldenAmiManifest();
    manifestSource = resolved.source;
    const candidate = resolveGoldenAmi({ manifest: resolved.manifest, region, arch });
    if (candidate && !candidate.owner) {
      console.log(
        `[remote-vm] golden AMI ${candidate.amiId} skipped: manifest has no owner to verify against`,
      );
    } else if (candidate && verifyAmiOwner(opts, candidate.amiId, candidate.owner)) {
      golden = candidate;
    } else if (candidate) {
      console.log(
        `[remote-vm] golden AMI ${candidate.amiId} failed owner verification; falling back to full install`,
      );
    }
  }
  const launchImageId = explicitImageId || golden?.amiId || DEFAULT_AWS_IMAGE;
  opts.imageId = launchImageId;
  // Why we did NOT take the golden path (null when we did) — stamped durably below
  // so a sandbox row alone explains a slow full-install without the deploy log.
  const goldenFallbackReason = golden
    ? null
    : explicitImageId
      ? "explicit-image-id"
      : noGolden
        ? "no-golden-flag"
        : `no-ami:${manifestSource}`;
  if (golden) {
    console.log(
      `[remote-vm] launching from golden AMI ${golden.amiId} (region=${region}, arch=${arch}, manifest=${manifestSource}, version=${golden.version ?? "?"})`,
    );
  } else {
    console.log(
      `[remote-vm] full-install path for region=${region} arch=${arch} (${goldenFallbackReason}); base image ${launchImageId}`,
    );
  }
  const userData = writeTempUserData(
    golden
      ? renderBootUserData({ apiKey, tls: true, idleTimeoutMinutes, setupScript })
      : renderUserData({ apiKey, tls: true, idleTimeoutMinutes, setupScript }),
  );

  let instanceId = "";
  try {
    const launched = awsJson(opts, buildAwsRunInstancesArgs(opts, {
      imageId: opts.imageId,
      securityGroupId: sg.securityGroupId,
      userDataFile: userData.file,
    }));
    instanceId = launched.Instances?.[0]?.InstanceId ?? "";
    if (!instanceId) throw new CliError("AWS did not return an EC2 instance id.");
    console.log(`[remote-vm] EC2 instance created: ${instanceId}`);
    runChecked("aws", awsArgs(opts, ["ec2", "wait", "instance-running", "--instance-ids", instanceId]), {
      timeout: 10 * 60 * 1000,
    });
    const described = awsJson(opts, ["ec2", "describe-instances", "--instance-ids", instanceId]);
    const instance = described.Reservations?.[0]?.Instances?.[0] ?? {};
    const publicIp = instance.PublicIpAddress ?? "";
    if (!publicIp) throw new CliError("EC2 instance is running but does not have a public IPv4 address.");

    const now = Date.now();
    const remoteConfig = createRemoteConfig({
      provider: "aws",
      providerId: instanceId,
      providerName: "AWS EC2",
      name,
      region,
      size: opts.size,
      image: opts.imageId,
      publicIp,
      sshUser: opts.keyName ? "ubuntu" : null,
      identityFile: opts.identityFile,
      localPort: opts.localPort,
      accessMode: "direct",
      tls: true,
      status: "provisioning",
      cloud: {
        securityGroupId: sg.securityGroupId,
        managedSecurityGroup: sg.managed,
        vpcId: sg.vpcId,
        subnetId: opts.subnetId || null,
        accessCidr,
        sshEnabled: !!opts.keyName,
        // Provenance of the launch image, for debugging fast-boot vs fallback.
        goldenImage: !!golden,
        imageArch: arch,
        imageManifestSource: manifestSource,
        imageManifestVersion: golden?.version ?? null,
        goldenFallbackReason,
      },
      projectId: projectId || null,
      createdAt: now,
      updatedAt: now,
    });
    try {
      insertRemoteVmSandbox(db, { id: sandboxId, name, apiKey, remoteConfig, activate: opts.activate, gitAuthMode, copyAgentCreds });
    } catch (err) {
      console.error(`[remote-vm] EC2 instance exists but SQLite write failed. Clean up with: aws ec2 terminate-instances --instance-ids ${instanceId} --region ${region}`);
      throw err;
    }

    if (!opts.noWait) {
      console.log("[remote-vm] waiting for cloud-init and agent health");
      try {
        const cert = await waitForRemoteAgentHttp({
          host: publicIp,
          port: AGENT_TLS_PORT,
          tls: true,
          timeoutSec: opts.waitTimeout,
        });
        updateRemoteVmStatus(
          db,
          sandboxId,
          "ready",
          null,
          cert ? { agentCa: cert.pem, agentCertSha256: cert.sha256 } : {},
        );
      } catch (err) {
        const consoleOutput = fetchAwsConsoleOutput(opts, instanceId);
        if (consoleOutput) {
          const tail = consoleOutput.split("\n").slice(-60).join("\n");
          console.error(`[remote-vm] EC2 serial console output (last 60 lines):\n${tail}`);
        }
        updateRemoteVmStatus(db, sandboxId, "provisioning_failed", err instanceof Error ? err.message : String(err));
        throw err;
      }
    }

    printDeployResult({
      sandboxId,
      name,
      provider: "AWS EC2",
      publicIp,
      localPort: opts.localPort,
      agentUrl: `wss://${publicIp}:${AGENT_TLS_PORT}/`,
      json: opts.json,
    });
  } finally {
    db.close();
    fs.rmSync(userData.dir, { recursive: true, force: true });
  }
}

async function deployDigitalOcean(flags) {
  const name = required(strFlag(flags, "name"), "--name is required.");
  const region = required(strFlag(flags, "region"), "--region is required.");
  const sshKeyInput = strFlag(flags, "ssh-key");
  const opts = {
    name,
    region,
    size: strFlag(flags, "size", DEFAULT_DO_SIZE),
    image: strFlag(flags, "image", DEFAULT_DO_IMAGE),
    sshKey: sshKeyInput,
    identityFile: strFlag(flags, "identity-file"),
    localPort: intFlag(flags, "local-port", null),
    waitTimeout: intFlag(flags, "wait-timeout", 900),
    noWait: boolFlag(flags, "no-wait"),
    activate: boolFlag(flags, "activate"),
    json: boolFlag(flags, "json"),
    enableMonitoring: !boolFlag(flags, "no-monitoring"),
  };
  const db = openMissionControlDb();
  preflightDoctl(opts);
  if (opts.sshKey) opts.sshKey = resolveDoSshKey(opts.sshKey);
  opts.localPort = opts.sshKey ? chooseLocalPort(db, opts.localPort) : null;
  const accessCidr = await accessCidrFor(flags);
  const apiKey = randomSecret();
  const sandboxId = strFlag(flags, "sandbox-id") || newId("sb");
  const userData = writeTempUserData(renderUserData({ apiKey }));

  try {
    const created = doctlJson(buildDoctlDropletCreateArgs(opts, { userDataFile: userData.file }));
    const droplet = firstItem(created);
    const dropletId = String(droplet?.ID ?? droplet?.id ?? "");
    if (!dropletId) throw new CliError("DigitalOcean did not return a droplet id.");
    console.log(`[remote-vm] Droplet created: ${dropletId}`);
    const refreshed = firstItem(
      doctlJson([
        "compute",
        "droplet",
        "get",
        dropletId,
        "--format",
        "ID,Name,PublicIPv4,Status",
      ]),
    );
    const publicIp = refreshed?.PublicIPv4 ?? refreshed?.public_ipv4 ?? droplet?.PublicIPv4 ?? "";
    if (!publicIp) throw new CliError("Droplet is active but does not have a public IPv4 address.");
    const now = Date.now();
    const remoteConfig = createRemoteConfig({
      provider: "digitalocean",
      providerId: dropletId,
      providerName: "DigitalOcean Droplet",
      name,
      region,
      size: opts.size,
      image: opts.image,
      publicIp,
      sshUser: opts.sshKey ? "root" : null,
      identityFile: opts.identityFile,
      localPort: opts.localPort,
      accessMode: "direct",
      status: "provisioning",
      cloud: {
        accessCidr,
        sshEnabled: !!opts.sshKey,
      },
      createdAt: now,
      updatedAt: now,
    });
    try {
      insertRemoteVmSandbox(db, { id: sandboxId, name, apiKey, remoteConfig, activate: opts.activate });
    } catch (err) {
      console.error(`[remote-vm] Droplet exists but SQLite write failed. Clean up with: doctl compute droplet delete ${dropletId} --force`);
      throw err;
    }

    try {
      const firewallId = createDigitalOceanFirewall(dropletId, accessCidr, { enableSsh: !!opts.sshKey });
      updateRemoteVmStatus(db, sandboxId, "provisioning", null, {
        cloud: { ...remoteConfig.cloud, firewallId },
      });
    } catch (err) {
      updateRemoteVmStatus(db, sandboxId, "provisioning_failed", err instanceof Error ? err.message : String(err));
      throw err;
    }

    if (!opts.noWait) {
      console.log("[remote-vm] waiting for cloud-init and agent health");
      try {
        await waitForRemoteAgentHttp({
          host: publicIp,
          port: AGENT_PORT,
          tls: false,
          timeoutSec: opts.waitTimeout,
        });
        updateRemoteVmStatus(db, sandboxId, "ready", null);
      } catch (err) {
        updateRemoteVmStatus(db, sandboxId, "provisioning_failed", err instanceof Error ? err.message : String(err));
        throw err;
      }
    }

    printDeployResult({
      sandboxId,
      name,
      provider: "DigitalOcean Droplet",
      publicIp,
      localPort: opts.localPort,
      agentUrl: `ws://${publicIp}:${AGENT_PORT}/`,
      json: opts.json,
    });
  } finally {
    db.close();
    fs.rmSync(userData.dir, { recursive: true, force: true });
  }
}

function printDeployResult({ sandboxId, name, provider, publicIp, localPort = null, agentUrl, json = false }) {
  console.log("");
  console.log(`[remote-vm] ${provider} sandbox ready in SQLite: ${name} (${sandboxId})`);
  console.log(`[remote-vm] VM public IP: ${publicIp}`);
  console.log(`[remote-vm] Agent URL: ${agentUrl}`);
  if (localPort) {
    console.log("[remote-vm] Optional SSH tunnel command:");
    console.log(`  pnpm remote-vm tunnel ${sandboxId} --local-port ${localPort}`);
  }
  if (json) {
    console.log(
      `REMOTE_VM_RESULT_JSON=${JSON.stringify({
        sandboxId,
        name,
        provider,
        publicIp,
        agentUrl,
        localPort,
      })}`,
    );
  }
}

function printList(flags) {
  const db = openMissionControlDb();
  try {
    const rows = listRemoteVmSandboxes(db);
    if (boolFlag(flags, "json")) {
      console.log(JSON.stringify(rows.map(publicSandboxRow), null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log("No remote VM sandboxes found.");
      return;
    }
    for (const row of rows) {
      const cfg = row.remoteConfig ?? {};
      console.log(`${row.id}\t${cfg.providerName ?? cfg.provider ?? "remote-vm"}\t${row.name}\t${cfg.status ?? "unknown"}\t${cfg.publicIp ?? "-"}\t${cfg.agentUrl ?? "-"}`);
    }
  } finally {
    db.close();
  }
}

function publicSandboxRow(row) {
  const { pairing_token: _pairingToken, ...rest } = row;
  return rest;
}

function requireManagedRemote(row, operation) {
  if (!row) throw new CliError(`Unknown sandbox id.`);
  if (row.kind !== "remote-vm") throw new CliError(`Only remote VM sandboxes can be ${operation}.`);
  const cfg = row.remoteConfig ?? {};
  if (!cfg.provider || !cfg.providerId) {
    throw new CliError("This remote VM sandbox was not provisioned by the cloud CLI.");
  }
  return cfg;
}

function remoteAgentUrlForHost(cfg, host) {
  const tls = cfg.tls === true || String(cfg.agentUrl ?? "").startsWith("wss://");
  const port = Number(cfg.agentPort ?? (tls ? AGENT_TLS_PORT : AGENT_PORT));
  return `${tls ? "wss" : "ws"}://${host}:${port}/`;
}

function agentHealthOptionsForHost(cfg, host) {
  const tls = cfg.tls === true || String(cfg.agentUrl ?? "").startsWith("wss://");
  return {
    host,
    port: Number(cfg.agentPort ?? (tls ? AGENT_TLS_PORT : AGENT_PORT)),
    tls,
  };
}

function readAwsInstancePublicIp(opts, instanceId) {
  const described = awsJson(opts, ["ec2", "describe-instances", "--instance-ids", instanceId]);
  const instance = described.Reservations?.[0]?.Instances?.[0] ?? {};
  return instance.PublicIpAddress ?? "";
}

function readAwsInstanceState(opts, instanceId) {
  const described = awsJson(opts, ["ec2", "describe-instances", "--instance-ids", instanceId]);
  const instance = described.Reservations?.[0]?.Instances?.[0] ?? {};
  return instance.State?.Name ?? null;
}

/**
 * True when an AWS CLI error means the instance no longer exists — it was
 * terminated/deleted out-of-band (e.g. in the AWS console) and aged out of the
 * API, so describe/terminate/start now report it as unknown. Terminating or
 * reconciling such an instance is a no-op, not a failure.
 */
export function isAwsInstanceMissingError(message) {
  return /InvalidInstanceID\.NotFound|instance ID .* does not exist|instance .* not found/i.test(
    String(message ?? ""),
  );
}

/**
 * Read the AWS instance state, but return the `"missing"` sentinel instead of
 * throwing when the instance no longer exists, so callers can surface a deleted
 * VM rather than crashing on InvalidInstanceID.NotFound.
 */
function readAwsInstanceStateSafe(opts, instanceId) {
  try {
    return readAwsInstanceState(opts, instanceId);
  } catch (err) {
    if (isAwsInstanceMissingError(err instanceof Error ? err.message : String(err))) {
      return "missing";
    }
    throw err;
  }
}

/**
 * True when a raw instance state means the VM is gone — terminated, on its way
 * to terminated, or no longer described by the API. A gone instance is not
 * resumable; reconcile flips the saved status to "missing" so the UI prompts the
 * user to remove the record or switch to Local.
 */
export function isGoneAwsInstanceState(state) {
  return state === "missing" || state === "terminated" || state === "shutting-down";
}

// Map a raw cloud instance state to a saved lifecycle status, or null to leave
// the current status untouched (running/pending are handled by start/resume).
export function statusForAwsInstanceState(state) {
  switch (state) {
    case "stopped":
    case "stopping":
    case "shutting-down":
      return "paused";
    default:
      return null;
  }
}

export function shouldPersistAwsReconciledStatus(currentStatus, instanceState, mappedStatus) {
  if (mappedStatus !== "paused") return false;
  if (currentStatus === "paused" || currentStatus === "resuming") return false;
  // While EC2 is still stopping, preserve the in-flight UI state. Once AWS
  // reports "stopped", the real provider state is authoritative.
  if (currentStatus === "pausing" && instanceState !== "stopped") return false;
  return true;
}

/**
 * Sync a managed remote VM's saved status with the cloud's real instance state.
 * The desktop calls this on demand (before switching to / resuming a sandbox) and
 * on a light poll so an idle-auto-stopped EC2 instance surfaces as "paused"
 * instead of a dead connection. Prints REMOTE_VM_RECONCILE_JSON= for the host.
 */
async function reconcile(id, flags) {
  const json = boolFlag(flags, "json");
  const db = openMissionControlDb();
  try {
    const row = readSandbox(db, id);
    const cfg = requireManagedRemote(row, "reconciled");
    let instanceState = null;
    let nextStatus = null;
    if (cfg.provider === "aws") {
      assertCommand("aws", "Install AWS CLI v2.");
      const opts = {
        region: cfg.region,
        profile: strFlag(flags, "profile", process.env.AWS_PROFILE || ""),
      };
      instanceState = readAwsInstanceStateSafe(opts, cfg.providerId);
      if (isGoneAwsInstanceState(instanceState)) {
        // The instance was terminated/deleted out-of-band — it can't be resumed.
        // Surface it as "missing" so the desktop prompts to remove the record.
        if (cfg.status !== "missing") nextStatus = "missing";
      } else {
        const mapped = statusForAwsInstanceState(instanceState);
        // Only flip to paused when the provider state is authoritative enough to
        // resolve the local lifecycle state. In particular, "pausing" should
        // become "paused" once AWS reports the instance is fully stopped.
        if (shouldPersistAwsReconciledStatus(cfg.status, instanceState, mapped)) {
          nextStatus = "paused";
        }
      }
    }
    const latestRow = nextStatus === null ? row : readSandbox(db, id);
    const latestCfg = nextStatus === null ? cfg : requireManagedRemote(latestRow, "reconciled");
    if (nextStatus === "paused") {
      const mapped = statusForAwsInstanceState(instanceState);
      if (!shouldPersistAwsReconciledStatus(latestCfg.status, instanceState, mapped)) {
        nextStatus = null;
      }
    } else if (nextStatus === "missing" && latestCfg.status === "missing") {
      nextStatus = null;
    }
    const changed = nextStatus !== null && nextStatus !== latestCfg.status;
    if (changed) {
      const message =
        nextStatus === "missing"
          ? "The cloud instance no longer exists. Remove this sandbox or switch to Local."
          : "Instance is stopped (idle auto-stop or manual stop).";
      const persisted = updateRemoteVmStatus(db, id, nextStatus, message, {}, {
        expectedRemoteConfig: latestRow?.remote_config,
      });
      if (!persisted) {
        nextStatus = null;
      }
    }
    const finalRow = nextStatus === null && changed ? readSandbox(db, id) : null;
    const result = {
      sandboxId: id,
      instanceState,
      status: nextStatus ?? finalRow?.remoteConfig?.status ?? latestCfg.status ?? null,
      changed: nextStatus !== null && changed,
    };
    if (json) console.log(`REMOTE_VM_RECONCILE_JSON=${JSON.stringify(result)}`);
    else console.log(`[remote-vm] ${id}: instance=${instanceState ?? "?"} status=${result.status ?? "?"}`);
  } finally {
    db.close();
  }
}

function readDoDropletPublicIp(dropletId) {
  const refreshed = firstItem(
    doctlJson([
      "compute",
      "droplet",
      "get",
      String(dropletId),
      "--format",
      "ID,Name,PublicIPv4,Status",
    ]),
  );
  return refreshed?.PublicIPv4 ?? refreshed?.public_ipv4 ?? "";
}

function withRailwayProject(cfg, fn) {
  const serviceName = cfg.cloud?.serviceName || cfg.providerId;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mc-railway-"));
  try {
    let workspaceId = null;
    try {
      workspaceId = resolveRailwayWorkspaceId();
    } catch {
      // Linking by project id alone still works for many accounts.
    }
    if (cfg.cloud?.projectId) {
      const linkArgs = ["link", "--project", String(cfg.cloud.projectId), "--environment", "production"];
      if (workspaceId) linkArgs.push("--workspace", workspaceId);
      railwayRun(linkArgs, { cwd: work, allowFail: true });
    }
    return fn({ cwd: work, serviceName });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function printStatus(id, flags) {
  const db = openMissionControlDb();
  try {
    const row = readSandbox(db, id);
    if (!row) throw new CliError(`Unknown sandbox id: ${id}`);
    const publicRow = publicSandboxRow(row);
    if (boolFlag(flags, "json")) {
      console.log(JSON.stringify(publicRow, null, 2));
      return;
    }
    const cfg = row.remoteConfig ?? {};
    console.log(`Sandbox: ${row.name} (${row.id})`);
    console.log(`Provider: ${cfg.providerName ?? cfg.provider ?? "remote-vm"}`);
    console.log(`Status: ${cfg.status ?? "unknown"}${cfg.statusMessage ? ` - ${cfg.statusMessage}` : ""}`);
    console.log(`VM: ${cfg.providerId ?? "-"} ${cfg.publicIp ?? ""}`);
    console.log(`Agent URL: ${cfg.agentUrl ?? "-"}`);
    if (cfg.localPort) {
      console.log(`Tunnel: pnpm remote-vm tunnel ${row.id} --local-port ${cfg.localPort}`);
    }
  } finally {
    db.close();
  }
}

async function tunnel(id, flags) {
  assertCommand("ssh", "Install OpenSSH client.");
  const db = openMissionControlDb();
  let row;
  try {
    row = readSandbox(db, id);
  } finally {
    db.close();
  }
  if (!row) throw new CliError(`Unknown sandbox id: ${id}`);
  const cfg = row.remoteConfig ?? {};
  if (!cfg.publicIp || !cfg.sshUser) {
    throw new CliError("This sandbox does not have cloud VM SSH metadata.");
  }
  const localPort = intFlag(flags, "local-port", cfg.localPort ?? DEFAULT_LOCAL_TUNNEL_PORT);
  if (!(await isPortFree(localPort))) {
    throw new CliError(`Local port ${localPort} is already in use.`);
  }
  const identityFile = strFlag(flags, "identity-file", cfg.identityFile || "");
  const args = buildSshArgs({
    host: cfg.publicIp,
    user: cfg.sshUser,
    identityFile,
    localPort,
  });
  console.log(`[remote-vm] forwarding ws://localhost:${localPort}/ to ${cfg.sshUser}@${cfg.publicIp}:127.0.0.1:${AGENT_PORT}`);
  console.log("[remote-vm] keep this process running while using the remote VM sandbox.");
  const child = spawn("ssh", args, { stdio: "inherit" });
  await new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) console.log(`[remote-vm] ssh tunnel exited by signal ${signal}`);
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}

async function pause(id, flags) {
  if (!boolFlag(flags, "yes")) throw new CliError("Refusing to pause without --yes.");
  const db = openMissionControlDb();
  try {
    const row = readSandbox(db, id);
    const cfg = requireManagedRemote(row, "paused");
    updateRemoteVmStatus(db, id, "pausing", null);
    if (cfg.provider === "aws") {
      assertCommand("aws", "Install AWS CLI v2.");
      const opts = {
        region: cfg.region,
        profile: strFlag(flags, "profile", process.env.AWS_PROFILE || ""),
      };
      runChecked("aws", awsArgs(opts, buildAwsInstanceLifecycleArgs("stop-instances", cfg.providerId)));
      runChecked("aws", awsArgs(opts, ["ec2", "wait", "instance-stopped", "--instance-ids", cfg.providerId]), {
        timeout: 10 * 60 * 1000,
      });
      updateRemoteVmStatus(db, id, "paused", "EC2 instance stopped. EBS storage is preserved.", {
        publicIp: null,
      });
      console.log(`[remote-vm] stopped EC2 instance ${cfg.providerId}`);
      return;
    }
    if (cfg.provider === "digitalocean") {
      assertCommand("doctl", "Install doctl.");
      const graceful = run("doctl", buildDoctlDropletActionArgs("shutdown", cfg.providerId), {
        timeout: 10 * 60 * 1000,
      });
      if (graceful.code !== 0) {
        runChecked("doctl", buildDoctlDropletActionArgs("power-off", cfg.providerId), {
          timeout: 10 * 60 * 1000,
        });
      }
      updateRemoteVmStatus(
        db,
        id,
        "paused",
        "Droplet powered off. DigitalOcean may still bill reserved Droplet resources.",
      );
      console.log(`[remote-vm] powered off droplet ${cfg.providerId}`);
      return;
    }
    if (cfg.provider === "railway") {
      preflightRailway();
      withRailwayProject(cfg, ({ cwd, serviceName }) => {
        railwayDownOptional(cwd, serviceName);
      });
      updateRemoteVmStatus(db, id, "paused", "Railway deployment stopped. Volume data is preserved.");
      console.log(`[remote-vm] stopped Railway deployment for service ${cfg.cloud?.serviceName || cfg.providerId}`);
      return;
    }
    throw new CliError(`Pause is not supported for provider ${cfg.provider}.`);
  } catch (err) {
    updateRemoteVmStatus(db, id, "pause_failed", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    db.close();
  }
}

async function resume(id, flags) {
  const db = openMissionControlDb();
  try {
    const row = readSandbox(db, id);
    const cfg = requireManagedRemote(row, "resumed");
    const waitTimeout = intFlag(flags, "wait-timeout", 900);
    const noWait = boolFlag(flags, "no-wait");
    updateRemoteVmStatus(db, id, "resuming", null);
    if (cfg.provider === "aws") {
      assertCommand("aws", "Install AWS CLI v2.");
      const opts = {
        region: cfg.region,
        profile: strFlag(flags, "profile", process.env.AWS_PROFILE || ""),
      };
      runChecked("aws", awsArgs(opts, buildAwsInstanceLifecycleArgs("start-instances", cfg.providerId)));
      runChecked("aws", awsArgs(opts, ["ec2", "wait", "instance-running", "--instance-ids", cfg.providerId]), {
        timeout: 10 * 60 * 1000,
      });
      const publicIp = readAwsInstancePublicIp(opts, cfg.providerId);
      if (!publicIp) throw new CliError("EC2 instance is running but does not have a public IPv4 address.");
      const agentUrl = remoteAgentUrlForHost(cfg, publicIp);
      const patch = { publicIp, agentUrl };
      if (!noWait) {
        console.log("[remote-vm] waiting for agent health");
        const cert = await waitForRemoteAgentHttp({
          ...agentHealthOptionsForHost(cfg, publicIp),
          timeoutSec: waitTimeout,
        });
        if (cert) {
          patch.agentCa = cert.pem;
          patch.agentCertSha256 = cert.sha256;
        }
      }
      updateRemoteVmStatus(db, id, "ready", null, patch);
      console.log(`[remote-vm] started EC2 instance ${cfg.providerId}`);
      return;
    }
    if (cfg.provider === "digitalocean") {
      assertCommand("doctl", "Install doctl.");
      runChecked("doctl", buildDoctlDropletActionArgs("power-on", cfg.providerId), {
        timeout: 10 * 60 * 1000,
      });
      const publicIp = readDoDropletPublicIp(cfg.providerId);
      if (!publicIp) throw new CliError("Droplet is active but does not have a public IPv4 address.");
      const agentUrl = remoteAgentUrlForHost(cfg, publicIp);
      const patch = { publicIp, agentUrl };
      if (!noWait) {
        console.log("[remote-vm] waiting for agent health");
        const cert = await waitForRemoteAgentHttp({
          ...agentHealthOptionsForHost(cfg, publicIp),
          timeoutSec: waitTimeout,
        });
        if (cert) {
          patch.agentCa = cert.pem;
          patch.agentCertSha256 = cert.sha256;
        }
      }
      updateRemoteVmStatus(db, id, "ready", null, patch);
      console.log(`[remote-vm] powered on droplet ${cfg.providerId}`);
      return;
    }
    if (cfg.provider === "railway") {
      preflightRailway();
      const domain = cfg.cloud?.domain || cfg.publicIp;
      if (!domain) throw new CliError("Railway sandbox is missing its public domain.");
      withRailwayProject(cfg, ({ cwd, serviceName }) => {
        railwayRun(["redeploy", "--service", String(serviceName), "--yes"], { cwd });
      });
      const agentUrl = `wss://${domain}/`;
      if (!noWait) {
        console.log("[remote-vm] waiting for Railway agent health");
        await waitForRemoteAgentHttp({
          host: domain,
          port: AGENT_TLS_PORT,
          tls: true,
          timeoutSec: waitTimeout,
        });
      }
      updateRemoteVmStatus(db, id, "ready", null, { publicIp: domain, agentUrl });
      console.log(`[remote-vm] redeployed Railway service ${cfg.cloud?.serviceName || cfg.providerId}`);
      return;
    }
    throw new CliError(`Resume is not supported for provider ${cfg.provider}.`);
  } catch (err) {
    updateRemoteVmStatus(db, id, "resume_failed", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    db.close();
  }
}

async function destroy(id, flags) {
  if (!boolFlag(flags, "yes")) throw new CliError("Refusing to destroy without --yes.");
  const db = openMissionControlDb();
  const row = readSandbox(db, id);
  if (!row) {
    db.close();
    throw new CliError(`Unknown sandbox id: ${id}`);
  }
  const cfg = row.remoteConfig ?? {};
  try {
    if (cfg.provider === "aws") {
      assertCommand("aws", "Install AWS CLI v2.");
      const opts = {
        region: cfg.region,
        profile: strFlag(flags, "profile", process.env.AWS_PROFILE || ""),
      };
      const terminate = run("aws", awsArgs(opts, [
        "ec2",
        "terminate-instances",
        "--instance-ids",
        cfg.providerId,
      ]));
      if (terminate.code === 0) {
        console.log(`[remote-vm] termination requested for EC2 instance ${cfg.providerId}`);
      } else {
        const detail = (terminate.stderr || terminate.stdout || "command failed").trim();
        // The instance was already deleted out-of-band — the desired end state is
        // reached, so treat "not found" as success and continue to row cleanup.
        if (isAwsInstanceMissingError(detail)) {
          console.log(`[remote-vm] EC2 instance ${cfg.providerId} already gone — nothing to terminate`);
        } else {
          throw new CliError(`aws ec2 terminate-instances failed: ${detail}`);
        }
      }
    } else if (cfg.provider === "digitalocean") {
      assertCommand("doctl", "Install doctl.");
      if (cfg.cloud?.firewallId) {
        run("doctl", ["compute", "firewall", "delete", String(cfg.cloud.firewallId), "--force"]);
      }
      runChecked("doctl", ["compute", "droplet", "delete", String(cfg.providerId), "--force"]);
      console.log(`[remote-vm] deleted droplet ${cfg.providerId}`);
    } else if (cfg.provider === "railway") {
      await cleanupRailwaySandbox(cfg);
      console.log(
        `[remote-vm] cleaned up Railway resources for service ${cfg.cloud?.serviceName || cfg.providerId}`,
      );
    } else if (!cfg.provider || !cfg.providerId) {
      console.log("[remote-vm] bring-your-own remote VM — no cloud resources to terminate");
    } else {
      throw new CliError(`Unsupported remote VM provider "${cfg.provider}".`);
    }
    // --keep-row terminates the instance but leaves the sandbox row for the caller
    // to delete (so Mission Control's server-side cleanup runs project teardown).
    if (boolFlag(flags, "keep-row")) {
      console.log(`[remote-vm] instance terminated; sandbox row ${id} left for caller to remove`);
    } else {
      db.prepare("DELETE FROM sandboxes WHERE id = ?").run(id);
      console.log(`[remote-vm] removed sandbox row ${id}`);
    }
  } catch (err) {
    updateRemoteVmStatus(db, id, "destroy_failed", err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    db.close();
  }
}

function printHelp() {
  console.log(`Mission Control remote VM CLI

Usage:
  pnpm remote-vm deploy aws --name <name> --region <region> [--size t3.medium]
  pnpm remote-vm deploy do --name <name> --region <region> [--size s-2vcpu-4gb]
  pnpm remote-vm deploy railway --name <name>
  pnpm remote-vm list [--json]
  pnpm remote-vm status <sandbox-id> [--json]
  pnpm remote-vm tunnel <sandbox-id> [--local-port 19333] [--identity-file ~/.ssh/key]
  pnpm remote-vm pause <sandbox-id> --yes
  pnpm remote-vm resume <sandbox-id>
  pnpm remote-vm destroy <sandbox-id> --yes

Common deploy flags:
  --access-cidr <cidr>    Source CIDR allowed to reach the agent port. Defaults to your public IPv4 /32.
  --wait-timeout <sec>    Bootstrap wait timeout. Default: 900.
  --no-wait              Store the VM after cloud creation without waiting for agent health.
  --activate             Make the new sandbox the active Mission Control scope.
  --json                 Print a machine-readable REMOTE_VM_RESULT_JSON line.

Lifecycle flags:
  --profile <profile>    AWS profile for pause/resume. Defaults to AWS_PROFILE.
  --wait-timeout <sec>   Resume agent health wait timeout. Default: 900.
  --no-wait              Resume provider compute without waiting for agent health.

AWS flags:
  --profile <profile>          AWS profile. Defaults to AWS_PROFILE when set.
  --key-name <aws-key>         Optional EC2 key pair for later SSH debugging.
  --identity-file <path>       Optional private key path stored for tunnel command.
  --local-port <port>          Optional local tunnel port when --key-name is used.
  --image-id <ami|resolve:ssm> Explicit image override. Omit to auto-resolve a
                               published golden AMI for the region/arch, else the
                               Ubuntu 24.04 SSM base + full install.
  --no-golden                  Skip the golden AMI; force the full-install path.
  --subnet-id <subnet>         Optional subnet. Default VPC is used when omitted.
  --security-group-id <sg>     Optional user-managed security group.

DigitalOcean flags:
  --ssh-key <id|fingerprint|name> Optional SSH key for later SSH debugging.
  --identity-file <path>          Optional private key path stored for tunnel command.
  --local-port <port>             Optional local tunnel port when --ssh-key is used.
  --image <slug>                  Default: ubuntu-24-04-x64
  --no-monitoring                 Skip DigitalOcean monitoring agent.

Railway:
  Requires the host 'railway' CLI to be logged in (railway login) and Git to be
  installed. Reuses or creates a "mission-control" project, clones the public
  AgentSystemLabs/mission-control-agent repo, uploads it with railway up, sets an
  auto-generated MC_AGENT_API_KEY, attaches the required /home/workspace volume,
  and generates a public domain. No region/size flags — Railway is usage-based.
`);
}

async function main(argv = process.argv.slice(2)) {
  const [command, subcommand, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "deploy") {
    const provider = subcommand;
    const { flags } = parseFlagArgs(rest);
    if (provider === "aws") return deployAws(flags);
    if (provider === "do" || provider === "digitalocean") return deployDigitalOcean(flags);
    if (provider === "railway") return deployRailway(flags);
    throw new CliError("deploy requires provider: aws, do, or railway.");
  }

  if (command === "list") {
    const { flags } = parseFlagArgs([subcommand, ...rest].filter(Boolean));
    printList(flags);
    return;
  }

  if (command === "status") {
    const id = required(subcommand, "status requires a sandbox id.");
    const { flags } = parseFlagArgs(rest);
    printStatus(id, flags);
    return;
  }

  if (command === "tunnel") {
    const id = required(subcommand, "tunnel requires a sandbox id.");
    const { flags } = parseFlagArgs(rest);
    await tunnel(id, flags);
    return;
  }

  if (command === "pause") {
    const id = required(subcommand, "pause requires a sandbox id.");
    const { flags } = parseFlagArgs(rest);
    await pause(id, flags);
    return;
  }

  if (command === "resume") {
    const id = required(subcommand, "resume requires a sandbox id.");
    const { flags } = parseFlagArgs(rest);
    await resume(id, flags);
    return;
  }

  if (command === "reconcile") {
    const id = required(subcommand, "reconcile requires a sandbox id.");
    const { flags } = parseFlagArgs(rest);
    await reconcile(id, flags);
    return;
  }

  if (command === "destroy") {
    const id = required(subcommand, "destroy requires a sandbox id.");
    const { flags } = parseFlagArgs(rest);
    await destroy(id, flags);
    return;
  }

  throw new CliError(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[remote-vm] ${message}`);
    process.exit(err instanceof CliError ? err.exitCode : 1);
  });
}
