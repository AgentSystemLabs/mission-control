import * as fs from "node:fs";
import * as path from "node:path";

const MARKER = "_mcManaged";

type HookEvent = { event: string; matcher?: string };
type HookEntry = { type: "command"; command: string };
type HookGroup = { matcher?: string; hooks: HookEntry[]; [MARKER]?: boolean };
type HooksFile = {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
};

type AgentHookSpec = {
  configPath: string[];
  endpointSlug: string;
  events: HookEvent[];
  removeManagedEvents?: string[];
};

const AGENT_HOOKS: Record<string, AgentHookSpec> = {
  "claude-code": {
    configPath: [".claude", "settings.local.json"],
    endpointSlug: "claude",
    events: [
      { event: "UserPromptSubmit" },
      { event: "Stop" },
      // PermissionRequest is the precise "human approval required" signal.
      // Notification also fires for idle reminders, so keep it narrowed to the
      // permission notification type for Claude builds that rely on it.
      { event: "PermissionRequest" },
      { event: "Notification", matcher: "permission_prompt" },
    ],
    removeManagedEvents: ["SubagentStop", "UserInterrupt"],
  },
  codex: {
    configPath: [".codex", "hooks.json"],
    endpointSlug: "codex",
    events: [
      { event: "UserPromptSubmit" },
      { event: "Stop" },
      { event: "PermissionRequest" },
    ],
  },
};

function buildHookCommand(endpointSlug: string): string {
  // Read stdin (the agent's hook payload JSON) and forward to Mission Control.
  // Fail-soft: never block the user's session if MC is down.
  return (
    'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ]; then exit 0; fi; ' +
    "curl -sS -m 3 -X POST " +
    '-H "Authorization: Bearer $MC_API_TOKEN" ' +
    '-H "Content-Type: application/json" ' +
    "--data-binary @- " +
    `"$MC_API_URL/api/hooks/${endpointSlug}?taskId=$MC_TASK_ID" ` +
    ">/dev/null 2>&1 || true"
  );
}

function buildManagedGroup(command: string, matcher?: string): HookGroup {
  return {
    ...(matcher === undefined ? {} : { matcher }),
    hooks: [{ type: "command", command }],
    [MARKER]: true,
  };
}

/**
 * Ensure the agent's project-local hook config carries Mission Control's hook
 * entries. Existing user hooks are preserved; we only add, replace, or remove
 * entries tagged with our `_mcManaged` marker.
 */
export function installAgentHooks(agent: string | undefined, cwd: string): void {
  if (!agent) return;
  const spec = AGENT_HOOKS[agent];
  if (!spec) return;

  const file = path.join(cwd, ...spec.configPath);
  const dir = path.dirname(file);

  let settings: HooksFile = {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (raw.trim()) settings = JSON.parse(raw);
  } catch (err) {
    // ENOENT is expected on first install; any other error (parse failure,
    // permission denied) means we should not clobber the file.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return;
  }

  const command = buildHookCommand(spec.endpointSlug);
  const hooks = (settings.hooks ??= {});
  for (const { event, matcher } of spec.events) {
    const groups = (hooks[event] ??= []);
    const filtered = groups.filter((g) => !g[MARKER]);
    filtered.push(buildManagedGroup(command, matcher));
    hooks[event] = filtered;
  }

  for (const event of spec.removeManagedEvents ?? []) {
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
    // best-effort - bubble up nothing; status will simply not update.
  }
}
