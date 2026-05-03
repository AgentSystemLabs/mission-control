import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseUsageLine } from "../services/token-usage";

describe("parseUsageLine", () => {
  it("returns null for blank or malformed lines", () => {
    expect(parseUsageLine("")).toBeNull();
    expect(parseUsageLine("   ")).toBeNull();
    expect(parseUsageLine("not json")).toBeNull();
    expect(parseUsageLine("{")).toBeNull();
  });

  it("returns null for non-assistant lines", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u1",
      message: { role: "user", content: "hi" },
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(parseUsageLine(line)).toBeNull();
  });

  it("returns null for assistant lines without usage", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "a1",
      message: { role: "assistant", content: "hi" },
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(parseUsageLine(line)).toBeNull();
  });

  it("extracts usage and timestamp from a valid assistant line", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "abc-123",
      timestamp: "2026-05-01T12:00:00.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 100,
          output_tokens: 250,
          cache_creation_input_tokens: 4_000,
          cache_read_input_tokens: 12_000,
        },
      },
    });
    const out = parseUsageLine(line);
    expect(out).not.toBeNull();
    expect(out!.uuid).toBe("abc-123");
    expect(out!.model).toBe("claude-opus-4-7");
    expect(out!.usage).toEqual({
      inputTokens: 100,
      outputTokens: 250,
      cacheCreationTokens: 4_000,
      cacheReadTokens: 12_000,
    });
    expect(out!.ts).toBe(Date.parse("2026-05-01T12:00:00.000Z"));
  });

  it("treats missing usage fields as zero", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "u",
      timestamp: "2026-05-01T12:00:00.000Z",
      message: { role: "assistant", usage: { input_tokens: 5 } },
    });
    const out = parseUsageLine(line);
    expect(out!.usage).toEqual({
      inputTokens: 5,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });
});

// Integration: ingestion against a real on-disk JSONL + temp DB. Exercises
// the dedupe + offset advance contract end-to-end.
describe("syncTokenUsage", () => {
  let tempUserDataDir: string;
  let fakeHome: string;
  let savedHome: string | undefined;
  let savedUserData: string | undefined;

  beforeEach(() => {
    tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-usage-data-"));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "mc-usage-home-"));
    fs.mkdirSync(path.join(fakeHome, ".claude", "projects", "stub"), {
      recursive: true,
    });
    savedHome = process.env.HOME;
    process.env.HOME = fakeHome;
    savedUserData = process.env.MC_USER_DATA_DIR;
    process.env.MC_USER_DATA_DIR = tempUserDataDir;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserData === undefined) delete process.env.MC_USER_DATA_DIR;
    else process.env.MC_USER_DATA_DIR = savedUserData;
    fs.rmSync(tempUserDataDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it("ingests assistant lines, dedupes on re-run, and advances byte offset", async () => {
    // Fresh module load so it picks up our env-overridden MC_USER_DATA_DIR.
    const { getDb, getSqlite } = await import("~/db/client");
    const { syncTokenUsage, _resetSyncSingleton } = await import(
      "../services/token-usage"
    );
    _resetSyncSingleton();

    // Seed project + task referencing a fake claude session id.
    const sqlite = getSqlite();
    getDb();
    const sessionId = "sess-xyz";
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, icon, icon_color, pinned, branch, remember_agent_settings, saved_skip_permissions, saved_bare_session, created_at, updated_at)
         VALUES ('p1', 'Demo', '/tmp/demo', 'folder', '#888', 0, 'main', 0, 0, 0, ?, ?)`
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, title, agent, status, branch, preview, lines, archived, claude_session_id, claude_skip_permissions, claude_bare_session, created_at, updated_at)
         VALUES ('t1', 'p1', 'a session', 'claude-code', 'ready', 'main', '', 0, 0, ?, 0, 0, ?, ?)`
      )
      .run(sessionId, now, now);

    const jsonlPath = path.join(
      fakeHome,
      ".claude",
      "projects",
      "stub",
      `${sessionId}.jsonl`
    );

    const line1 = JSON.stringify({
      type: "assistant",
      uuid: "msg-1",
      timestamp: "2026-05-01T12:00:00.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    });
    fs.writeFileSync(jsonlPath, line1 + "\n");

    const ingested1 = await syncTokenUsage();
    expect(ingested1).toBe(1);

    const ingested2 = await syncTokenUsage();
    expect(ingested2).toBe(0);

    // Append a second line; only the new one should be ingested.
    const line2 = JSON.stringify({
      type: "assistant",
      uuid: "msg-2",
      timestamp: "2026-05-01T12:01:00.000Z",
      message: {
        role: "assistant",
        usage: {
          input_tokens: 5,
          output_tokens: 30,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 2000,
        },
      },
    });
    fs.appendFileSync(jsonlPath, line2 + "\n");
    const ingested3 = await syncTokenUsage();
    expect(ingested3).toBe(1);

    const total = sqlite
      .prepare("SELECT COUNT(*) AS c FROM token_usage")
      .get() as { c: number };
    expect(total.c).toBe(2);

    // Cascade-delete: removing the task should clear its usage rows.
    sqlite.prepare("DELETE FROM tasks WHERE id = 't1'").run();
    const after = sqlite
      .prepare("SELECT COUNT(*) AS c FROM token_usage")
      .get() as { c: number };
    expect(after.c).toBe(0);
  });
});
