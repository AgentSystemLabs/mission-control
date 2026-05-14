import { AGENT_REGISTRY } from "~/shared/agents";
import { TITLE_GENERATING, TITLE_WAITING, isSentinelTitle } from "~/lib/task-sentinels";
import { runCli } from "./claude-cli";
import { getTask, updateTask } from "./tasks";

const META_PROMPT =
  "Generate a concise 4-7 word title (no quotes, no trailing punctuation, plain text only) for the following task. Respond with the title and nothing else.\n\nTask:\n";

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

export async function generateTitleForTask(taskId: string, prompt: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;
  if (!isSentinelTitle(task.title)) return; // user has set a manual title
  if (!prompt.trim()) return;

  const invocation = AGENT_REGISTRY[task.agent].titleInvocation?.(META_PROMPT + prompt);
  if (!invocation) return; // agent has no print mode — leave sentinel

  // Move from "Waiting" → "Generating".
  if (task.title === TITLE_WAITING) {
    await updateTask(taskId, { title: TITLE_GENERATING });
  }

  try {
    const raw = await runCli(invocation.cmd, invocation.args);
    const title = sanitizeTitle(raw);
    const fresh = await getTask(taskId);
    if (!fresh || !isSentinelTitle(fresh.title)) return; // user edited mid-flight
    if (title) {
      await updateTask(taskId, { title });
    } else {
      await updateTask(taskId, { title: fallbackTitle(prompt) });
    }
  } catch {
    const fresh = await getTask(taskId);
    if (fresh && isSentinelTitle(fresh.title)) {
      await updateTask(taskId, { title: fallbackTitle(prompt) });
    }
  }
}

function fallbackTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "Untitled task";
  return firstLine.length > 60 ? firstLine.slice(0, 60).trim() + "…" : firstLine;
}
