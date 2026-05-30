import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Git auth provisioning inside the sandbox (US: "Set up an SSH key"). Two modes,
// the user picks (sandbox.gitAuthMode):
//   - copy:     write key files the host sent (a copy of ~/.ssh)
//   - generate: create an ed25519 keypair in the VM and return the public key
// Keys live under ~/.ssh, which the compose mounts on the mc-agent-ssh named
// volume so they persist across container restart/rebuild.

export type SshSetupParams =
  | { mode: "generate" }
  | { mode: "copy"; files: Array<{ name: string; content: string }> };

export type SshSetupResult = { publicKey?: string };

// Only allow plain basenames into ~/.ssh — no separators / traversal.
const SAFE_SSH_FILENAME = /^[A-Za-z0-9._-]+$/;
const PUBLIC_FILES = new Set(["known_hosts", "config"]);

// GitHub's published SSH host key (https://docs.github.com/authentication/
// keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). Pinned
// rather than discovered via `ssh-keyscan`, which is trust-on-first-use and can
// be poisoned by a MITM on a hostile network — seeding an attacker-controlled
// host key would defeat host verification for every later `git@github.com` op.
const PINNED_KNOWN_HOSTS: Record<string, string> = {
  "github.com":
    "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
};

function modeFor(name: string): number {
  return name.endsWith(".pub") || PUBLIC_FILES.has(name) ? 0o644 : 0o600;
}

export class SshRpc {
  constructor(private readonly sshDir: string = path.join(os.homedir(), ".ssh")) {}

  async setup(params: SshSetupParams): Promise<SshSetupResult> {
    fs.mkdirSync(this.sshDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.sshDir, 0o700);
    } catch {
      /* best effort */
    }

    if (params.mode === "copy") {
      for (const f of params.files ?? []) {
        if (!f || typeof f.name !== "string" || typeof f.content !== "string") continue;
        if (!SAFE_SSH_FILENAME.test(f.name) || f.name === "." || f.name === "..") continue;
        const dest = path.join(this.sshDir, f.name);
        fs.writeFileSync(dest, f.content, { mode: modeFor(f.name) });
        try {
          fs.chmodSync(dest, modeFor(f.name));
        } catch {
          /* best effort */
        }
      }
      this.ensureKnownHost("github.com");
      return {};
    }

    // generate
    const keyPath = path.join(this.sshDir, "id_ed25519");
    if (!fs.existsSync(keyPath)) {
      await execFileAsync("ssh-keygen", [
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "mission-control-sandbox",
        "-f",
        keyPath,
      ]);
    }
    this.ensureKnownHost("github.com");
    const publicKey = fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
    return { publicKey };
  }

  /** Append the pinned host key for `host` to known_hosts (idempotent, no network). */
  private ensureKnownHost(host: string): void {
    const pinned = PINNED_KNOWN_HOSTS[host];
    if (!pinned) return;
    const knownHosts = path.join(this.sshDir, "known_hosts");
    try {
      const existing = fs.existsSync(knownHosts) ? fs.readFileSync(knownHosts, "utf8") : "";
      if (existing.includes(pinned)) return;
      const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
      fs.appendFileSync(knownHosts, `${prefix}${pinned}\n`, { mode: 0o644 });
    } catch {
      // Best effort — if known_hosts isn't writable, clone still prompts host-key acceptance.
    }
  }
}
