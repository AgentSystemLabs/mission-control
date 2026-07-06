import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-prompts-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { createTask, archiveTask } = await import("../tasks");
const { recordPrompt, searchPromptHistory } = await import("../prompts");
const { getDb } = await import("~/db/client");
const { prompts, tasks, projects, groups, worktrees } = await import("~/db/schema");

function resetDb() {
  const db = getDb();
  db.delete(prompts).run();
  db.delete(tasks).run();
  db.delete(worktrees).run();
  db.delete(projects).run();
  db.delete(groups).run();
}

function makeProject(name = "proj") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-prompts-proj-"));
  return createProject({ name, path: dir });
}

function makeTask(projectId: string, title = "session") {
  return createTask({ projectId, title, agent: "claude-code" });
}

function countPrompts(): number {
  return getDb().select().from(prompts).all().length;
}

describe("prompts service", () => {
  beforeEach(() => {
    resetDb();
  });

  it("records a submitted prompt with its session context", () => {
    const project = makeProject();
    const task = makeTask(project.id, "My session");
    recordPrompt({ taskId: task.id, text: "add a dark mode toggle" });

    const rows = getDb().select().from(prompts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe(task.id);
    expect(rows[0]!.projectId).toBe(project.id);
    expect(rows[0]!.agent).toBe("claude-code");
    expect(rows[0]!.text).toBe("add a dark mode toggle");
  });

  it("ignores empty prompts and unknown tasks", () => {
    const project = makeProject();
    const task = makeTask(project.id);
    recordPrompt({ taskId: task.id, text: "   " });
    recordPrompt({ taskId: "task-missing", text: "hello" });
    expect(countPrompts()).toBe(0);
  });

  it("dedups an identical prompt captured twice for the same task", () => {
    const project = makeProject();
    const task = makeTask(project.id);
    // A hook-capable agent fires BOTH the hook and the terminal fallback for
    // one submission — recordPrompt is called twice with identical text.
    recordPrompt({ taskId: task.id, text: "same prompt" });
    recordPrompt({ taskId: task.id, text: "same prompt" });
    expect(countPrompts()).toBe(1);
    // A genuinely different prompt is still its own row.
    recordPrompt({ taskId: task.id, text: "another prompt" });
    expect(countPrompts()).toBe(2);
  });

  it("searches over prompt text, session title, and project name", () => {
    const project = makeProject("acme-web");
    const task = makeTask(project.id, "Fix the login flow");
    recordPrompt({ taskId: task.id, text: "add dark mode toggle" });

    expect(searchPromptHistory("dark")).toHaveLength(1); // text
    expect(searchPromptHistory("login")).toHaveLength(1); // session title
    expect(searchPromptHistory("acme")).toHaveLength(1); // project name
    expect(searchPromptHistory("nonexistent")).toHaveLength(0);
  });

  it("treats LIKE wildcards in the query as literal characters", () => {
    const project = makeProject();
    const task = makeTask(project.id);
    recordPrompt({ taskId: task.id, text: "deploy to 100% done" });
    recordPrompt({ taskId: task.id, text: "no percent here" });
    // `%` must match literally, not as a wildcard.
    expect(searchPromptHistory("100%")).toHaveLength(1);
  });

  it("excludes archived sessions from search and recents", () => {
    const project = makeProject();
    const task = makeTask(project.id);
    recordPrompt({ taskId: task.id, text: "hello world" });
    archiveTask(task.id);
    expect(searchPromptHistory("hello")).toHaveLength(0);
    expect(searchPromptHistory("")).toHaveLength(0);
  });

  it("returns recent prompts newest-first for an empty query", () => {
    vi.useFakeTimers();
    try {
      const project = makeProject();
      const task = makeTask(project.id);
      vi.setSystemTime(new Date(1_000_000));
      recordPrompt({ taskId: task.id, text: "first" });
      vi.setSystemTime(new Date(1_000_000 + 20_000));
      recordPrompt({ taskId: task.id, text: "second" });
      const recent = searchPromptHistory("");
      expect(recent.map((r) => r.text)).toEqual(["second", "first"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
