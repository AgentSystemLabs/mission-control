import { spawn } from "node:child_process";
import type { TaskAgent } from "~/db/schema";
import { TITLE_GENERATING, TITLE_WAITING, isSentinelTitle } from "~/lib/task-sentinels";
import { getTask, updateTask } from "./tasks";

const META_PROMPT =
  "Generate a concise 4-7 word title (no quotes, no trailing punctuation, plain text only) for the following task. Respond with the title and nothing else.\n\nTask:\n";

const GENERATION_TIMEOUT_MS = 60_000;

type PrintInvocation = { cmd: string; args: (input: string) => string[] } | null;

function invocationFor(agent: TaskAgent): PrintInvocation {
  switch (agent) {
    case "claude-code":
      return { cmd: "claude", args: (input) => ["-p", input] };
    case "codex":
      return { cmd: "codex", args: (input) => ["exec", input] };
    case "cursor-cli":
      return { cmd: "cursor-agent", args: (input) => ["-p", input] };
    default:
      return null;
  }
}

function sanitizeTitle(raw: string): string {
  let t = raw.trim();
  // Take last non-empty line — many CLIs print preamble before the answer.
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) t = lines[lines.length - 1]!;
  t = t.replace(/^["'`]+|["'`]+$/g, "");
  t = t.replace(/[.!?,;:]+$/g, "");
  const words = t.split(/\s+/).filter(Boolean).slice(0, 7);
  t = words.join(" ");
  if (t.length > 80) t = t.slice(0, 80).trim();
  return t;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function runCli(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Spawn through the user's login shell so claude/codex/cursor-agent
    // resolve via the same PATH the rest of the app uses (see pty-manager).
    const userShell = process.env.SHELL || "/bin/sh";
    const line = [cmd, ...args].map(shellQuote).join(" ");
    const child = spawn(userShell, ["-l", "-c", line], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("timeout"));
    }, GENERATION_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `exit ${code}`));
    });
  });
}

export async function generateTitleForTask(taskId: string, prompt: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;
  if (!isSentinelTitle(task.title)) return; // user has set a manual title
  if (!prompt.trim()) return;

  const invocation = invocationFor(task.agent);
  if (!invocation) return; // agent has no print mode — leave sentinel

  // Move from "Waiting" → "Generating".
  if (task.title === TITLE_WAITING) {
    updateTask(taskId, { title: TITLE_GENERATING });
  }

  try {
    const raw = await runCli(invocation.cmd, invocation.args(META_PROMPT + prompt));
    const title = sanitizeTitle(raw);
    const fresh = getTask(taskId);
    if (!fresh || !isSentinelTitle(fresh.title)) return; // user edited mid-flight
    if (title) {
      updateTask(taskId, { title });
    } else {
      updateTask(taskId, { title: fallbackTitle(prompt) });
    }
  } catch {
    const fresh = getTask(taskId);
    if (fresh && isSentinelTitle(fresh.title)) {
      updateTask(taskId, { title: fallbackTitle(prompt) });
    }
  }
}

function fallbackTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "Untitled task";
  return firstLine.length > 60 ? firstLine.slice(0, 60).trim() + "…" : firstLine;
}
