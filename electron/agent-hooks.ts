import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "./logger";

// Per-file single-flight chain. Concurrent ptySpawn calls hitting the same
// agent config file would otherwise clobber each other's read-mutate-write.
const fileMutex = new Map<string, Promise<void>>();

function withFileLock(file: string, work: () => Promise<void>): Promise<void> {
  const prev = fileMutex.get(file) ?? Promise.resolve();
  const next = prev.then(work, work);
  fileMutex.set(
    file,
    next.catch(() => {
      // Errors in `work` must not poison subsequent waiters.
    }),
  );
  return next;
}

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
    'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ] || [ -z "$MC_TASK_TOKEN" ]; then exit 0; fi; ' +
    "curl -sS -m 3 -X POST " +
    '-H "Authorization: Bearer $MC_TASK_TOKEN" ' +
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
export type AgentHooksFailure = {
  taskId: string;
  agent: string;
  reason: "unreadable" | "write-failed";
  file: string;
};

export function installAgentHooks(
  agent: string | undefined,
  cwd: string,
  opts?: { taskId?: string; onFailure?: (info: AgentHooksFailure) => void },
): Promise<void> {
  if (!agent) return Promise.resolve();
  const spec = AGENT_HOOKS[agent];
  if (!spec) return Promise.resolve();

  const file = path.join(cwd, ...spec.configPath);
  const dir = path.dirname(file);
  const notify = (reason: AgentHooksFailure["reason"]) => {
    if (!opts?.onFailure || !opts.taskId) return;
    try {
      opts.onFailure({ taskId: opts.taskId, agent, reason, file });
    } catch {
      /* never let notification failure mask the original error */
    }
  };

  return withFileLock(file, async () => {
    let settings: HooksFile = {};
    try {
      const raw = await fs.promises.readFile(file, "utf8");
      if (raw.trim()) {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          logger.warn("skipping hooks install — settings.json not an object", { file });
          notify("unreadable");
          return;
        }
        settings = parsed as HooksFile;
      }
    } catch (err) {
      // ENOENT is expected on first install; any other error (parse failure,
      // permission denied) means we should not clobber the file.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn("skipping hooks install — settings.json unreadable", {
          err,
          file,
        });
        notify("unreadable");
        return;
      }
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
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = path.join(
        dir,
        `${path.basename(file)}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      );
      await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
      await fs.promises.rename(tmp, file);
    } catch (err) {
      // best-effort - status will simply not update.
      logger.warn("agent hooks write failed", {
        err,
        op: "agentHooks.install",
        file,
      });
      notify("write-failed");
    }
  });
}
