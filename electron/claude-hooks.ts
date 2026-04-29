import * as fs from "node:fs";
import * as path from "node:path";

const MARKER = "_mcManaged";

// Read stdin (Claude's hook payload JSON) and forward to Mission Control.
// Fail-soft: never block the user's session if MC is down. Claude Code
// runs `command` via `/bin/sh -c`, so this is a plain shell snippet.
const HOOK_CMD =
  'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ]; then exit 0; fi; ' +
  "curl -sS -m 3 -X POST " +
  '-H "Authorization: Bearer $MC_API_TOKEN" ' +
  '-H "Content-Type: application/json" ' +
  "--data-binary @- " +
  '"$MC_API_URL/api/hooks/claude?taskId=$MC_TASK_ID" ' +
  ">/dev/null 2>&1 || true";

const HOOKS: Array<{ event: string; matcher?: string }> = [
  { event: "UserPromptSubmit" },
  { event: "Stop" },
  // PermissionRequest is the precise "human approval required" signal.
  // Notification also fires for idle reminders, so keep it narrowed to the
  // permission notification type for Claude builds that rely on it.
  { event: "PermissionRequest" },
  { event: "Notification", matcher: "permission_prompt" },
];
const LEGACY_EVENTS = ["SubagentStop"];

type HookEntry = { type: "command"; command: string };
type HookGroup = { matcher?: string; hooks: HookEntry[]; [MARKER]?: boolean };
type Settings = {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
};

function buildManagedGroup(matcher?: string): HookGroup {
  return {
    ...(matcher === undefined ? {} : { matcher }),
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
  for (const { event, matcher } of HOOKS) {
    const groups = (hooks[event] ??= []);
    const filtered = groups.filter((g) => !g[MARKER]);
    filtered.push(buildManagedGroup(matcher));
    hooks[event] = filtered;
  }
  for (const event of LEGACY_EVENTS) {
    const groups = hooks[event];
    if (!groups) continue;
    const filtered = groups.filter((g) => !g[MARKER]);
    if (filtered.length) hooks[event] = filtered;
    else delete hooks[event];
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — bubble up nothing; status will simply not update.
  }
}
