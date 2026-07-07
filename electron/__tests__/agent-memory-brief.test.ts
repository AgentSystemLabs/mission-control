import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

import { installAgentMemoryBrief } from "../agent-memory-brief";
import type { PtyHookEnv } from "../pty-hook-env";

const MC_ENV: PtyHookEnv = { apiUrl: "http://127.0.0.1:5174", token: "test-token" };

function writeStaleBrief(cwd: string): string {
  const file = path.join(cwd, "CLAUDE.local.md");
  fs.writeFileSync(
    file,
    "user notes\n\n<!-- mc:recall:start (managed by Mission Control — do not edit inside these markers) -->\nstale brief from a previous session\n<!-- mc:recall:end -->\n",
    "utf8",
  );
  return file;
}

describe("installAgentMemoryBrief", () => {
  let cwd = "";

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-brief-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the fetched brief into the agent's auto-load file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ brief: "fresh brief" }))),
    );

    await installAgentMemoryBrief({ agent: "claude-code", cwd, taskId: "t-1", mcEnv: MC_ENV });

    const content = fs.readFileSync(path.join(cwd, "CLAUDE.local.md"), "utf8");
    expect(content).toContain("fresh brief");
  });

  it("strips a stale brief when the fetch fails, so the SessionStart fallback can't double up", async () => {
    const file = writeStaleBrief(cwd);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );

    await installAgentMemoryBrief({ agent: "claude-code", cwd, taskId: "t-1", mcEnv: MC_ENV });

    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("user notes");
    expect(content).not.toContain("stale brief");
    expect(content).not.toContain("mc:recall:start");
  });

  it("keeps the file intact on a non-OK response", async () => {
    // 404/401 isn't the startup race — treat it as "server said no" and leave
    // whatever is on disk alone (matches the pre-fallback behavior).
    const file = writeStaleBrief(cwd);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );

    await installAgentMemoryBrief({ agent: "claude-code", cwd, taskId: "t-1", mcEnv: MC_ENV });

    expect(fs.readFileSync(file, "utf8")).toContain("stale brief");
  });
});
