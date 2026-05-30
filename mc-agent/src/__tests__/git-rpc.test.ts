import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitRpc } from "../git-rpc";

let workspace: string;
let repo: string;
let rpc: GitRpc;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grpc-"));
  repo = path.join(workspace, "proj");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  fs.writeFileSync(path.join(repo, "tracked.txt"), "original\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-q", "-m", "init");
  rpc = new GitRpc(workspace);
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("GitRpc.status", () => {
  it("reports a clean repo", async () => {
    const s = await rpc.status({ repo });
    expect(typeof s.branch).toBe("string");
    expect(s.branch.length).toBeGreaterThan(0);
    expect(s.staged).toEqual([]);
    expect(s.unstaged).toEqual([]);
    expect(s.changedCount).toBe(0);
  });

  it("reports an unstaged modification and an untracked file", async () => {
    fs.writeFileSync(path.join(repo, "tracked.txt"), "original\nchanged\n");
    fs.writeFileSync(path.join(repo, "fresh.txt"), "new file\n");
    const s = await rpc.status({ repo });
    expect(s.unstaged).toContainEqual({ path: "tracked.txt", status: "modified" });
    expect(s.unstaged).toContainEqual({ path: "fresh.txt", status: "untracked" });
    expect(s.changedCount).toBe(2);
  });

  it("throws for a repo path outside the workspace", async () => {
    await expect(rpc.status({ repo: path.join(workspace, "..", "outside") })).rejects.toThrow();
  });
});

describe("GitRpc.diff", () => {
  it("returns a text diff for a modified tracked file", async () => {
    const d = await rpc.diff({ repo, file: "tracked.txt", staged: false });
    expect(d.kind).toBe("text");
    if (d.kind === "text") expect(d.patch).toContain("+changed");
  });

  it("renders an untracked file as an additions diff", async () => {
    const d = await rpc.diff({ repo, file: "fresh.txt", staged: false });
    expect(d.kind).toBe("text");
    if (d.kind === "text") {
      expect(d.patch).toContain("--- /dev/null");
      expect(d.patch).toContain("+new file");
    }
  });
});

describe("GitRpc.clone", () => {
  it("rejects an invalid slug", async () => {
    await expect(rpc.clone({ remote: "https://example.com/r.git", slug: "../escape" })).rejects.toThrow(
      /invalid slug/,
    );
  });

  it("rejects an option-injection / non-URL remote", async () => {
    await expect(rpc.clone({ remote: "--upload-pack=evil", slug: "ok" })).rejects.toThrow(
      /invalid remote/,
    );
  });

  it("rejects ext:: and file:// transports (RCE / local-read vectors)", async () => {
    await expect(rpc.clone({ remote: "ext::sh -c evil", slug: "ok" })).rejects.toThrow(
      /unsupported remote protocol/,
    );
    await expect(rpc.clone({ remote: "file:///etc/passwd", slug: "ok" })).rejects.toThrow(
      /unsupported remote protocol/,
    );
  });

  it("accepts SSH remotes before slug validation", async () => {
    await expect(rpc.clone({ remote: "git@github.com:owner/repo.git", slug: "../escape" })).rejects.toThrow(
      /invalid slug/,
    );
    await expect(
      rpc.clone({ remote: "ssh://git@example.com/owner/repo.git", slug: "../escape" }),
    ).rejects.toThrow(/invalid slug/);
  });

  it("rejects unsafe SSH remote shapes", async () => {
    await expect(rpc.clone({ remote: "-Fconfig@example.com:owner/repo.git", slug: "ok" })).rejects.toThrow(
      /invalid remote|unsupported/,
    );
    await expect(rpc.clone({ remote: "ssh://-Fconfig@example.com/owner/repo.git", slug: "ok" })).rejects.toThrow(
      /unsupported SSH remote/,
    );
    await expect(rpc.clone({ remote: "git@example.com:-oProxyCommand=evil/repo.git", slug: "ok" })).rejects.toThrow(
      /invalid remote|unsupported/,
    );
    await expect(rpc.clone({ remote: "ssh://git:secret@example.com/owner/repo.git", slug: "ok" })).rejects.toThrow(
      /unsupported SSH remote/,
    );
  });

  it("refuses to clone over a non-empty existing destination before invoking git", async () => {
    fs.mkdirSync(path.join(workspace, "taken"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "taken", "file.txt"), "occupied\n");
    await expect(
      rpc.clone({ remote: "https://example.com/r.git", slug: "taken" }),
    ).rejects.toThrow(/already exists/);
  });

  it("allows clone to proceed when the destination is an existing empty directory", async () => {
    fs.mkdirSync(path.join(workspace, "empty-slot"), { recursive: true });
    await expect(
      rpc.clone({ remote: "https://127.0.0.1:1/nope.git", slug: "empty-slot" }),
    ).rejects.toThrow(/git clone failed/);
  }, 20_000);

  it("scrubs embedded credentials from a clone failure message", async () => {
    // Unreachable host:port so git fails fast (GIT_TERMINAL_PROMPT=0); the URL it
    // echoes in stderr must not carry the password back to the caller/UI.
    let message = "";
    try {
      await rpc.clone({
        remote: "https://user:s3cr3tPw@127.0.0.1:1/nope.git?token=querySecret#fragSecret",
        slug: "scrubtest",
      });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/git clone failed/);
    expect(message).not.toContain("s3cr3tPw");
    expect(message).not.toContain("user:");
    expect(message).not.toContain("querySecret");
    expect(message).not.toContain("fragSecret");
  }, 20_000);
});
