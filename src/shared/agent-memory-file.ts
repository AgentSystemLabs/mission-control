import * as fs from "node:fs";
import * as path from "node:path";

// Recall injection — writes the Session Brief into the file each agent auto-loads
// at startup, as a marker-delimited managed block (mirrors agent-hooks.ts's
// `_mcManaged` approach). Single source of truth; re-exported from
// electron/agent-memory-file.ts.
//
// Privacy (decision D2 — app-private only): the brief goes into a file that is
// git-ignored so project memory never lands in a commit. Claude Code's
// `CLAUDE.local.md` is both auto-loaded AND conventionally git-ignored, so it is
// the Phase 1 target. Other agents lack a guaranteed private auto-load file, so
// they are intentionally omitted here until a private channel is settled for
// each (adding one is a single entry in AGENT_MEMORY_TARGETS).

const MC_RECALL_START = "<!-- mc:recall:start (managed by Mission Control — do not edit inside these markers) -->";
const MC_RECALL_END = "<!-- mc:recall:end -->";
const MC_RECALL_START_PREFIX = "<!-- mc:recall:start";

type MemoryTarget = {
  /** Path segments of the auto-loaded file, relative to the session cwd. */
  file: string[];
  /** Whether to ensure the file is git-ignored (keeps memory private). */
  gitIgnore: boolean;
};

const AGENT_MEMORY_TARGETS: Record<string, MemoryTarget | undefined> = {
  "claude-code": { file: ["CLAUDE.local.md"], gitIgnore: true },
  // codex / opencode / cursor-cli: deferred — see note above.
};

/** Whether Recall can inject a brief for this agent today. */
export function supportsMemoryInjection(agent: string | undefined): boolean {
  return !!agent && !!AGENT_MEMORY_TARGETS[agent];
}

/** Remove the managed Recall block from `content`, leaving user content intact. */
function stripRecallBlock(content: string): string {
  const start = content.indexOf(MC_RECALL_START_PREFIX);
  if (start === -1) return content;
  const endAt = content.indexOf(MC_RECALL_END, start);
  if (endAt === -1) return content; // malformed — don't clobber user content
  const before = content.slice(0, start).replace(/\s+$/, "");
  const after = content.slice(endAt + MC_RECALL_END.length).replace(/^\s+/, "");
  return [before, after].filter(Boolean).join("\n\n").trim();
}

/**
 * Append `relPath` to the repo's `.gitignore` if the session cwd is a git root
 * and the path isn't already ignored. Best-effort; never throws.
 */
function ensureGitIgnored(cwd: string, relPath: string): void {
  try {
    // `.git` is a dir at a repo root and a file inside a worktree — both count.
    if (!fs.existsSync(path.join(cwd, ".git"))) return;
    const gitignore = path.join(cwd, ".gitignore");
    let content = "";
    try {
      content = fs.readFileSync(gitignore, "utf8");
    } catch {
      /* no .gitignore yet */
    }
    const existing = new Set(content.split(/\r?\n/).map((l) => l.trim()));
    if (existing.has(relPath) || existing.has(`/${relPath}`)) return;
    const prefix = content && !content.endsWith("\n") ? "\n" : "";
    const addition = `${prefix}\n# Mission Control Recall (project memory) — private, do not commit\n${relPath}\n`;
    fs.writeFileSync(gitignore, content + addition, "utf8");
  } catch {
    /* best-effort */
  }
}

/**
 * Write/refresh the managed Recall block in the agent's auto-load file. An empty
 * `brief` removes the block. Returns true when a supported agent's file was
 * touched. Never throws — injection must never block a session from starting.
 */
export function writeAgentMemoryFile(
  agent: string | undefined,
  cwd: string,
  brief: string,
): boolean {
  if (!agent) return false;
  const target = AGENT_MEMORY_TARGETS[agent];
  if (!target) return false;

  const file = path.join(cwd, ...target.file);
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }

  const base = stripRecallBlock(existing);
  const trimmed = brief.trim();
  let next: string;
  if (!trimmed) {
    next = base ? `${base}\n` : "";
  } else {
    const block = `${MC_RECALL_START}\n${trimmed}\n${MC_RECALL_END}\n`;
    next = base ? `${base}\n\n${block}` : block;
  }

  try {
    // Nothing to write and no file existed → don't create an empty file.
    if (!next && !existing) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next, "utf8");
  } catch {
    return false;
  }

  if (trimmed && target.gitIgnore) ensureGitIgnored(cwd, target.file.join("/"));
  return true;
}

/** Strip the Recall block from the agent's file (e.g. when Recall is disabled). */
export function removeAgentMemoryFile(agent: string | undefined, cwd: string): void {
  writeAgentMemoryFile(agent, cwd, "");
}
