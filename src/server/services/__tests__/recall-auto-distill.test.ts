import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-autodistill-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

// Control what the (CLI-backed) engine "returns" so the test never spawns a CLI.
const distillSession = vi.fn();
vi.mock("../recall-engine", () => ({
  distillSession: (...args: unknown[]) => distillSession(...args),
  DISTILL_INPUT_CHAR_BUDGET: 8000,
}));

const { createProject } = await import("../projects");
const { createTask, updateStatus } = await import("../tasks");
const { recordPrompt } = await import("../prompts");
const { listMemory } = await import("../project-memory");
const { writeRecallSettings } = await import("../recall-settings");
const { registerRecallAutoDistill, __resetAutoDistillCooldown } = await import(
  "../recall-auto-distill"
);
const { setTranscriptPath, __resetTranscriptPaths } = await import("../session-transcripts");
const { events } = await import("../../events");
const { getDb } = await import("~/db/client");
const { projectMemory, projects, groups, tasks, worktrees, prompts } = await import("~/db/schema");

registerRecallAutoDistill();

function resetDb() {
  const db = getDb();
  db.delete(projectMemory).run();
  db.delete(prompts).run();
  db.delete(tasks).run();
  db.delete(worktrees).run();
  db.delete(projects).run();
  db.delete(groups).run();
}

function makeProjectWithSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-autodistill-proj-"));
  const project = createProject({ name: "proj", path: dir });
  const task = createTask({ projectId: project.id, title: "Wire up auth", agent: "claude-code" });
  recordPrompt({ taskId: task.id, text: "the auth flow lives in useAuth" });
  return { project, task };
}

/** Wait for the fire-and-forget distill triggered by session:finished to settle. */
function waitForLearned(): Promise<{ count: number; projectId: string } | null> {
  return new Promise((resolve) => {
    const off = events.onAny((e) => {
      if (e.type === "memory:learned") {
        off();
        resolve({ count: e.count, projectId: e.projectId });
      }
    });
    setTimeout(() => {
      off();
      resolve(null);
    }, 300);
  });
}

describe("recall auto-distill on session:finished", () => {
  beforeEach(() => {
    resetDb();
    __resetAutoDistillCooldown();
    __resetTranscriptPaths();
    distillSession.mockReset();
    writeRecallSettings({ enabled: true, autoCaptureEnabled: true, recallEngineEnabled: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes distilled memories and emits memory:learned", async () => {
    const { project, task } = makeProjectWithSession();
    distillSession.mockResolvedValue([
      { type: "architecture", title: "Auth flow lives in useAuth", body: "" },
      { type: "decision", title: "Use JWT over cookies", body: "stateless" },
    ]);

    const learned = waitForLearned();
    updateStatus(task.id, { status: "finished" });
    const result = await learned;

    expect(distillSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ count: 2, projectId: project.id });
    const memories = listMemory(project.id);
    expect(memories.map((m) => m.title).sort()).toEqual([
      "Auth flow lives in useAuth",
      "Use JWT over cookies",
    ]);
    expect(memories.every((m) => m.source === "auto-distill")).toBe(true);
    expect(memories.every((m) => m.confidence === "inferred")).toBe(true);
    expect(memories.every((m) => m.sourceTaskId === task.id)).toBe(true);
  });

  it("does nothing when auto-capture is disabled", async () => {
    writeRecallSettings({ autoCaptureEnabled: false });
    const { task } = makeProjectWithSession();
    distillSession.mockResolvedValue([{ type: "stack", title: "x", body: "" }]);

    const learned = waitForLearned();
    updateStatus(task.id, { status: "finished" });
    expect(await learned).toBeNull();
    expect(distillSession).not.toHaveBeenCalled();
  });

  it("does nothing when the Recall engine is disabled", async () => {
    writeRecallSettings({ recallEngineEnabled: false });
    const { task } = makeProjectWithSession();

    const learned = waitForLearned();
    updateStatus(task.id, { status: "finished" });
    expect(await learned).toBeNull();
    expect(distillSession).not.toHaveBeenCalled();
  });

  it("skips a repeat finish within the cooldown window", async () => {
    const { task } = makeProjectWithSession();
    distillSession.mockResolvedValue([{ type: "stack", title: "Electron app", body: "" }]);

    const first = waitForLearned();
    updateStatus(task.id, { status: "finished" });
    await first;
    expect(distillSession).toHaveBeenCalledTimes(1);

    // Flip to running and back to finished — within cooldown, no second distill.
    updateStatus(task.id, { status: "running" });
    const second = waitForLearned();
    updateStatus(task.id, { status: "finished" });
    expect(await second).toBeNull();
    expect(distillSession).toHaveBeenCalledTimes(1);
  });

  it("feeds the session transcript to the distiller when one was reported", async () => {
    const { task } = makeProjectWithSession();
    const transcriptFile = path.join(tmpRoot, `transcript-${task.id}.jsonl`);
    fs.writeFileSync(
      transcriptFile,
      [
        JSON.stringify({ type: "user", message: { content: "add a rate limiter" } }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "I'll add a token-bucket limiter in middleware." },
              { type: "tool_use", name: "Edit", input: { file_path: "src/mw/rate-limit.ts" } },
            ],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    setTranscriptPath(task.id, transcriptFile);
    distillSession.mockResolvedValue([
      { type: "architecture", title: "Rate limiting is token-bucket middleware", body: "" },
    ]);

    const learned = waitForLearned();
    updateStatus(task.id, { status: "finished" });
    await learned;

    expect(distillSession).toHaveBeenCalledTimes(1);
    const arg = distillSession.mock.calls[0][0] as { transcript: string | null };
    expect(arg.transcript).toContain("ASSISTANT: I'll add a token-bucket limiter");
    expect(arg.transcript).toContain("TOOL(Edit): src/mw/rate-limit.ts");
  });

  it("falls back to prompts-only when the transcript path is unreadable", async () => {
    const { task } = makeProjectWithSession();
    setTranscriptPath(task.id, path.join(tmpRoot, "does-not-exist.jsonl"));
    distillSession.mockResolvedValue([{ type: "stack", title: "Electron app", body: "" }]);

    const learned = waitForLearned();
    updateStatus(task.id, { status: "finished" });
    await learned;

    expect(distillSession).toHaveBeenCalledTimes(1);
    const arg = distillSession.mock.calls[0][0] as { transcript: string | null; prompts: string[] };
    expect(arg.transcript).toBeNull();
    expect(arg.prompts.length).toBeGreaterThan(0);
  });
});
