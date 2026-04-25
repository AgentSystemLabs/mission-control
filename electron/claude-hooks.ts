import * as fs from "node:fs";
import * as path from "node:path";

const MARKER = "_mcManaged";

const HOOK_CMD = [
  "sh",
  "-c",
  // Read stdin (Claude's hook payload JSON) and forward to Mission Control.
  // Fail-soft: never block the user's session if MC is down.
  'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ]; then exit 0; fi; ' +
    "curl -sS -m 3 -X POST " +
    '-H "Authorization: Bearer $MC_API_TOKEN" ' +
    '-H "Content-Type: application/json" ' +
    "--data-binary @- " +
    '"$MC_API_URL/api/hooks/claude?taskId=$MC_TASK_ID" ' +
    ">/dev/null 2>&1 || true",
].join(" ");

// Events we care about. "Notification" covers the "Claude needs your input"
// permission prompt case in current Claude Code; older builds also emit
// "PermissionRequest" — registering both is harmless if one is unknown.
const EVENTS = [
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "Notification",
  "PermissionRequest",
];

type HookEntry = { type: "command"; command: string };
type HookGroup = { matcher?: string; hooks: HookEntry[]; [MARKER]?: boolean };
type Settings = {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
};

function buildManagedGroup(): HookGroup {
  return {
    matcher: "",
    hooks: [{ type: "command", command: HOOK_CMD }],
    [MARKER]: true,
  };
}

/**
 * Ensure `<cwd>/.claude/settings.local.json` carries Mission Control's hook
 * entries. Existing user hooks are preserved; we only add or replace entries
 * tagged with our `_mcManaged` marker.
 */
export function installClaudeHooks(cwd: string): void {
  const dir = path.join(cwd, ".claude");
  const file = path.join(dir, "settings.local.json");

  let settings: Settings = {};
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      if (raw.trim()) settings = JSON.parse(raw);
    }
  } catch {
    // If the file is malformed, do not clobber it — just skip installing.
    return;
  }

  const hooks = (settings.hooks ??= {});
  for (const event of EVENTS) {
    const groups = (hooks[event] ??= []);
    const filtered = groups.filter((g) => !g[MARKER]);
    filtered.push(buildManagedGroup());
    hooks[event] = filtered;
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — bubble up nothing; status will simply not update.
  }
}
