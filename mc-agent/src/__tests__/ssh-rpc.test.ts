import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SshRpc } from "../ssh-rpc";

let sshDir: string;

beforeEach(() => {
  sshDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mc-ssh-")), ".ssh");
});
afterEach(() => {
  fs.rmSync(path.dirname(sshDir), { recursive: true, force: true });
});

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

describe("SshRpc copy mode", () => {
  it("writes provided key files with private=0600 / public=0644 perms", async () => {
    const rpc = new SshRpc(sshDir);
    await rpc.setup({
      mode: "copy",
      files: [
        { name: "id_ed25519", content: "PRIVATE" },
        { name: "id_ed25519.pub", content: "ssh-ed25519 AAAA pub" },
        { name: "known_hosts", content: "github.com ssh-ed25519 AAAA" },
      ],
    });
    expect(fs.readFileSync(path.join(sshDir, "id_ed25519"), "utf8")).toBe("PRIVATE");
    expect(mode(path.join(sshDir, "id_ed25519"))).toBe(0o600);
    expect(mode(path.join(sshDir, "id_ed25519.pub"))).toBe(0o644);
    expect(mode(path.join(sshDir, "known_hosts"))).toBe(0o644);
    expect(mode(sshDir)).toBe(0o700);
  });

  it("ignores path-traversal / unsafe filenames", async () => {
    const rpc = new SshRpc(sshDir);
    await rpc.setup({
      mode: "copy",
      files: [
        { name: "../evil", content: "x" },
        { name: "a/b", content: "x" },
        { name: "..", content: "x" },
      ],
    });
    // Nothing escaped the ssh dir.
    expect(fs.existsSync(path.join(path.dirname(sshDir), "evil"))).toBe(false);
    expect(fs.readdirSync(sshDir)).toEqual([]);
  });
});

describe("SshRpc generate mode", () => {
  it("generates an ed25519 keypair and returns the public key", async () => {
    const rpc = new SshRpc(sshDir);
    const r = await rpc.setup({ mode: "generate" });
    expect(fs.existsSync(path.join(sshDir, "id_ed25519"))).toBe(true);
    expect(fs.existsSync(path.join(sshDir, "id_ed25519.pub"))).toBe(true);
    expect(r.publicKey).toMatch(/^ssh-ed25519 /);
    expect(mode(path.join(sshDir, "id_ed25519"))).toBe(0o600);
  });

  it("is idempotent — a second generate keeps the same key", async () => {
    const rpc = new SshRpc(sshDir);
    const first = await rpc.setup({ mode: "generate" });
    const second = await rpc.setup({ mode: "generate" });
    expect(second.publicKey).toBe(first.publicKey);
  });

  it("pins GitHub's published host key (no ssh-keyscan TOFU) and doesn't duplicate it", async () => {
    const rpc = new SshRpc(sshDir);
    await rpc.setup({ mode: "generate" });
    const knownHosts = fs.readFileSync(path.join(sshDir, "known_hosts"), "utf8");
    expect(knownHosts).toContain(
      "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
    );
    await rpc.setup({ mode: "generate" });
    const after = fs.readFileSync(path.join(sshDir, "known_hosts"), "utf8");
    expect(after.match(/github\.com ssh-ed25519/g)).toHaveLength(1);
  });
});
