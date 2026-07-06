import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskAgent } from "../src/shared/domain";

// The managed key in the project's `.mcp.json`. Using a fixed key is the marker:
// we overwrite exactly this entry on each spawn (idempotent) and never touch any
// other server the user configured.
const MANAGED_SERVER_KEY = "recall";
const MCP_SCRIPT_NAME = "recall-mcp.mjs";
// The pre-rename key (graph-only server). Removed on write so upgraders don't
// keep an orphaned entry pointing at the old, deleted script.
const LEGACY_SERVER_KEY = "recall-graph";

// Candidate locations for the bundled MCP script, dev → packaged. In dev it runs
// straight from the repo (resolving @modelcontextprotocol/sdk from node_modules);
// packaged it's the esbuild-bundled, self-contained copy shipped under resources/
// (mirrors whisper-server.ts asset resolution).
function scriptCandidates(appPath: string): string[] {
  const candidates: string[] = [];
  // Packaged: shipped via extraResources under the app's Resources dir.
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "bundled-mcp", MCP_SCRIPT_NAME));
  }
  // Dev: `app.getAppPath()` resolves to `<repo>/dist-electron/electron`, so the
  // repo root is two levels up; `process.cwd()` is the repo root directly (the
  // electron main is launched from there). Cover both, plus the packaged asar
  // layout (appPath itself), so resolution is robust across run modes.
  candidates.push(path.join(process.cwd(), "bundled-mcp", MCP_SCRIPT_NAME));
  candidates.push(path.join(process.cwd(), "dist", "bundled-mcp", MCP_SCRIPT_NAME));
  candidates.push(path.join(appPath, "bundled-mcp", MCP_SCRIPT_NAME));
  candidates.push(path.join(appPath, "dist", "bundled-mcp", MCP_SCRIPT_NAME));
  candidates.push(path.join(appPath, "..", "bundled-mcp", MCP_SCRIPT_NAME));
  candidates.push(path.join(appPath, "..", "..", "bundled-mcp", MCP_SCRIPT_NAME));
  return candidates;
}

function resolveMcpScript(appPath: string): string | null {
  for (const candidate of scriptCandidates(appPath)) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* unreadable candidate — keep looking */
    }
  }
  return null;
}

/**
 * Append `.mcp.json` to the repo's `.gitignore` if the cwd is a git root and it
 * isn't already ignored. The file holds a machine-specific absolute script path
 * and is regenerated every session, so it should never be committed. Best-effort;
 * never throws. Mirrors ensureGitIgnored in src/shared/agent-memory-file.ts.
 */
function ensureMcpConfigGitIgnored(cwd: string): void {
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
    if (existing.has(".mcp.json") || existing.has("/.mcp.json")) return;
    const prefix = content && !content.endsWith("\n") ? "\n" : "";
    const addition = `${prefix}\n# Mission Control Recall (code graph MCP) — machine-specific, do not commit\n.mcp.json\n`;
    fs.writeFileSync(gitignore, content + addition, "utf8");
  } catch {
    /* best-effort */
  }
}

function readJsonObject(file: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Write a marker-managed `mcpServers.recall-graph` entry into the project's
 * `.mcp.json` so a local Claude Code session spawns the Recall code-graph MCP
 * server. File-based config only — never touches the spawn argv (the spawn
 * policy blocks `--mcp-config` flags), and only for local Claude sessions.
 *
 * Preserves every other key + server the user configured; only our own entry is
 * overwritten. The spawned server inherits MC_API_URL / MC_API_TOKEN /
 * MC_TASK_ID from the session env. Fully fail-soft — never blocks PTY spawn.
 */
export function ensureRecallMcpForAgent(
  appPath: string,
  cwd: string,
  agent: TaskAgent | undefined,
): void {
  // 4a: Claude Code only. Other harnesses get the query-skill fallback later.
  if (agent !== "claude-code") return;
  const script = resolveMcpScript(appPath);
  if (!script) return;

  try {
    const configPath = path.join(cwd, ".mcp.json");
    const config = readJsonObject(configPath);
    const servers =
      config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
        ? (config.mcpServers as Record<string, unknown>)
        : {};

    const desired = {
      command: "node",
      args: [script],
      // The MCP SDK's stdio transport does NOT forward arbitrary parent env to
      // the server child (only a safelist), so we must pass these through the
      // config. Claude Code expands `${VAR:-}` against its own session env — which
      // carries MC_API_URL / MC_API_TOKEN / MC_TASK_ID — so no secret is written
      // to disk; the empty default keeps an unset var from erroring the config.
      env: {
        MC_API_URL: "${MC_API_URL:-}",
        MC_API_TOKEN: "${MC_API_TOKEN:-}",
        MC_TASK_ID: "${MC_TASK_ID:-}",
      },
    };

    const hadLegacy = LEGACY_SERVER_KEY in servers;
    // Idempotent: skip the write when our entry already matches and the legacy
    // key is already gone.
    if (!hadLegacy && JSON.stringify(servers[MANAGED_SERVER_KEY]) === JSON.stringify(desired)) return;

    delete servers[LEGACY_SERVER_KEY];
    servers[MANAGED_SERVER_KEY] = desired;
    config.mcpServers = servers;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    ensureMcpConfigGitIgnored(cwd);
  } catch {
    /* swallow — MCP config write must never block PTY spawn */
  }
}
