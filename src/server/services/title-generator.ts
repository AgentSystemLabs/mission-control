import { AGENT_REGISTRY } from "~/shared/agents";
import type { TaskAgent } from "~/shared/domain";
import { TITLE_GENERATING, TITLE_WAITING, isSentinelTitle } from "~/lib/task-sentinels";
import { SESSION_ICON_OPTIONS, isSessionIcon } from "~/lib/session-icons";
import { runCli } from "./claude-cli";
import { getTask, updateTask } from "./tasks";

/**
 * Print-mode CLI invocations (claude -p, cursor-agent -p, codex exec) are
 * unreliable about emitting strict JSON when the surrounding prompt is large.
 * Asking for a two-line key:value format ("TITLE: …" / "ICON: …") is far more
 * compliant: the model produces it almost verbatim, the parser is trivial, and
 * we can still fall back to JSON or last-line plaintext if the model improvises.
 */
function buildMetaPrompt(): string {
  const iconList = SESSION_ICON_OPTIONS.map((o) => `- ${o.id} (${o.hint})`).join("\n");
  return [
    "You are naming a developer's coding session. Pick a short title and a matching icon.",
    "",
    "Reply with EXACTLY two lines and nothing else:",
    "TITLE: <4 to 7 words, plain text, no quotes, no trailing punctuation>",
    "ICON: <one id from the allowed list below>",
    "",
    "Examples:",
    "",
    "Task: Refactor the auth middleware to use JWT instead of session cookies.",
    "TITLE: Switch auth from cookies to JWT",
    "ICON: shield-check",
    "",
    "Task: The login page is broken when clicking submit twice quickly.",
    "TITLE: Fix double-submit on login button",
    "ICON: bug",
    "",
    "Task: Add a dark mode toggle to the settings panel.",
    "TITLE: Add dark mode toggle",
    "ICON: palette",
    "",
    "Task: Migrate the users table to add an email_verified column.",
    "TITLE: Add email-verified column to users",
    "ICON: database",
    "",
    "Allowed icon ids:",
    iconList,
    "",
    "Now do the real task. Respond with TITLE: and ICON: on two lines.",
    "",
    "Task: ",
  ].join("\n");
}

const META_PROMPT = buildMetaPrompt();

// Spawning cursor-agent -p while an interactive cursor-agent PTY is active can
// destabilize the running session and crash the Electron main process (EPIPE).
const CURSOR_TITLE_CLI_FALLBACKS: TaskAgent[] = ["claude-code", "codex"];

export function resolveTitleInvocation(
  agent: TaskAgent,
  prompt: string,
): { cmd: string; args: string[] } | undefined {
  const input = META_PROMPT + prompt;
  if (agent !== "cursor-cli") {
    return AGENT_REGISTRY[agent].titleInvocation?.(input);
  }
  for (const fallbackAgent of CURSOR_TITLE_CLI_FALLBACKS) {
    const invocation = AGENT_REGISTRY[fallbackAgent].titleInvocation?.(input);
    if (invocation) return invocation;
  }
  return undefined;
}

type Parsed = { title: string; icon: string | null };

/**
 * Walk the string from the end and yield every balanced `{…}` block as a
 * candidate JSON payload. CLIs (especially codex exec) often print preamble or
 * diagnostic text that may itself contain stray `{`/`}` — a single greedy regex
 * would match across them and fail to parse. Returning the right-most balanced
 * block first matches where the final answer typically lives.
 */
function* candidateJsonBlocks(s: string): Generator<string> {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] !== "}") continue;
    let depth = 0;
    for (let j = i; j >= 0; j--) {
      const ch = s[j];
      if (ch === "}") depth++;
      else if (ch === "{") {
        depth--;
        if (depth === 0) {
          yield s.slice(j, i + 1);
          break;
        }
      }
    }
  }
}

const TITLE_MAX_WORDS = 7;
const TITLE_MAX_LEN = 80;
const FALLBACK_TITLE_MAX_LEN = 60;

function sanitizeTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^["'`]+|["'`]+$/g, "");
  t = t.replace(/[.!?,;:]+$/g, "");
  const words = t.split(/\s+/).filter(Boolean).slice(0, TITLE_MAX_WORDS);
  t = words.join(" ");
  if (t.length > TITLE_MAX_LEN) t = t.slice(0, TITLE_MAX_LEN).trim();
  return t;
}

function tryKeyValueFormat(raw: string): Parsed | null {
  // Match the LAST TITLE: / ICON: lines so any preamble or repeated examples
  // can't shadow the real answer.
  const titleMatches = [...raw.matchAll(/^\s*TITLE\s*[:=]\s*(.+?)\s*$/gim)];
  const iconMatches = [...raw.matchAll(/^\s*ICON\s*[:=]\s*([a-z0-9-]+)\s*$/gim)];
  const titleRaw = titleMatches.length ? titleMatches[titleMatches.length - 1]![1] : "";
  const iconRaw = iconMatches.length ? iconMatches[iconMatches.length - 1]![1] : "";

  const title = sanitizeTitle(titleRaw);
  if (!title) return null;
  const icon = isSessionIcon(iconRaw) ? iconRaw : null;
  return { title, icon };
}

function tryJsonFormat(raw: string): Parsed | null {
  const unfenced = raw.replace(/^```[a-zA-Z]*\s*|\s*```$/g, "").trim();
  for (const block of candidateJsonBlocks(unfenced)) {
    try {
      const obj = JSON.parse(block);
      const title = typeof obj?.title === "string" ? sanitizeTitle(obj.title) : "";
      if (!title) continue;
      const icon = isSessionIcon(obj?.icon) ? obj.icon : null;
      return { title, icon };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function parseResponse(raw: string): Parsed {
  const trimmed = raw.trim();

  // Primary format: the one we ask for.
  const kv = tryKeyValueFormat(trimmed);
  if (kv) return kv;

  // Backstop: if the model decided to return JSON anyway, accept it.
  const json = tryJsonFormat(trimmed);
  if (json) return json;

  // Last-ditch: assume the model returned a bare one-line title.
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return { title: sanitizeTitle(last), icon: null };
}

export async function generateTitleForTask(taskId: string, prompt: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;
  if (task.titleManuallySet) return;
  if (!isSentinelTitle(task.title)) return; // existing finalized title
  if (!prompt.trim()) return;

  const invocation = resolveTitleInvocation(task.agent, prompt);
  if (!invocation) {
    if (task.title === TITLE_WAITING) {
      updateTask(taskId, { title: fallbackTitle(prompt) });
    }
    return;
  }

  // Move from "Waiting" → "Generating".
  if (task.title === TITLE_WAITING) {
    updateTask(taskId, { title: TITLE_GENERATING });
  }

  try {
    const raw = await runCli(invocation.cmd, invocation.args);
    const parsed = parseResponse(raw);
    if (process.env.MC_LOG_TITLE_GEN) {
      // Opt-in diagnostic. Pipe to a file when starting the app to capture
      // CLI output verbatim while iterating on the prompt format.
      console.log("[title-gen] raw:\n" + raw);
      console.log("[title-gen] parsed:", parsed);
    }
    const fresh = getTask(taskId);
    if (!fresh || fresh.titleManuallySet || !isSentinelTitle(fresh.title)) return; // user edited mid-flight
    if (parsed.title) {
      updateTask(taskId, { title: parsed.title, icon: parsed.icon });
    } else {
      updateTask(taskId, { title: fallbackTitle(prompt) });
    }
  } catch (e) {
    if (process.env.MC_LOG_TITLE_GEN) {
      console.error("[title-gen] CLI error:", e);
    }
    const fresh = getTask(taskId);
    if (fresh && !fresh.titleManuallySet && isSentinelTitle(fresh.title)) {
      updateTask(taskId, { title: fallbackTitle(prompt) });
    }
  }
}

function fallbackTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "Untitled task";
  return firstLine.length > FALLBACK_TITLE_MAX_LEN
    ? firstLine.slice(0, FALLBACK_TITLE_MAX_LEN).trim() + "…"
    : firstLine;
}
