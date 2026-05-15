import * as fs from "node:fs";
import * as path from "node:path";

const MARKER = "_mcManaged";

type HookEvent = { event: string; matcher?: string };
type HookEntry = {
  type: "command";
  command: string;
  shell?: "bash" | "powershell";
};
type ClaudeHookGroup = { matcher?: string; hooks: HookEntry[]; [MARKER]?: boolean };
type CursorHookGroup = { command: string; [MARKER]?: boolean };
type HookGroup = ClaudeHookGroup | CursorHookGroup;
type HooksFile = {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
};

type AgentHookSpec = {
  configPath: string[];
  endpointSlug: string;
  events: HookEvent[];
  style?: "claude" | "cursor";
  removeManagedEvents?: string[];
};

type HookCommand = {
  command: string;
  shell?: "powershell";
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
  "cursor-cli": {
    configPath: [".cursor", "hooks.json"],
    endpointSlug: "cursor",
    style: "cursor",
    events: [
      { event: "beforeSubmitPrompt" },
      { event: "stop" },
      { event: "afterAgentResponse" },
    ],
  },
};

function buildPosixHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor"
): string {
  // Read stdin (the agent's hook payload JSON) and forward to Mission Control.
  // Fail-soft: never block the user's session if MC is down.
  const url = `"$MC_API_URL/api/hooks/${endpointSlug}?taskId=$MC_TASK_ID&hookEvent=${encodeURIComponent(event)}"`;
  if (style === "cursor") {
    return (
      'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ]; then printf \'{"continue":true}\\n\'; exit 0; fi; ' +
      "payload=$(cat); " +
      "curl -sS -m 3 -X POST " +
      '-H "Authorization: Bearer $MC_API_TOKEN" ' +
      '-H "Content-Type: application/json" ' +
      "--data-binary \"$payload\" " +
      `${url} >/dev/null 2>&1 || true; ` +
      "printf '{\"continue\":true}\\n'"
    );
  }
  return (
    'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ]; then exit 0; fi; ' +
    "curl -sS -m 3 -X POST " +
    '-H "Authorization: Bearer $MC_API_TOKEN" ' +
    '-H "Content-Type: application/json" ' +
    "--data-binary @- " +
    `${url} ` +
    ">/dev/null 2>&1 || true"
  );
}

function buildPowerShellHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor"
): string {
  const eventParam = encodeURIComponent(event);
  const missingEnv =
    style === "cursor"
      ? 'if (-not $env:MC_TASK_ID -or -not $env:MC_API_URL) { Write-Output \'{"continue":true}\'; exit 0 }'
      : "if (-not $env:MC_TASK_ID -or -not $env:MC_API_URL) { exit 0 }";
  const continueOutput =
    style === "cursor" ? '; Write-Output \'{"continue":true}\'' : "";

  return [
    missingEnv,
    "$payload = [Console]::In.ReadToEnd()",
    "$taskId = [System.Uri]::EscapeDataString($env:MC_TASK_ID)",
    `$url = "$($env:MC_API_URL)/api/hooks/${endpointSlug}?taskId=$taskId&hookEvent=${eventParam}"`,
    '$headers = @{ Authorization = "Bearer $($env:MC_API_TOKEN)" }',
    'try { Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -ContentType "application/json" -TimeoutSec 3 -ErrorAction Stop | Out-Null } catch {}' +
      continueOutput,
  ].join("; ");
}

function buildHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor",
  platform: NodeJS.Platform
): HookCommand {
  if (platform === "win32" && style === "claude") {
    return {
      command: buildPowerShellHookCommand(endpointSlug, event, style),
      shell: "powershell",
    };
  }
  return { command: buildPosixHookCommand(endpointSlug, event, style) };
}

function buildManagedGroup(
  hookCommand: HookCommand,
  style: "claude" | "cursor",
  matcher?: string
): HookGroup {
  if (style === "cursor") {
    return {
      command: hookCommand.command,
      [MARKER]: true,
    };
  }
  return {
    ...(matcher === undefined ? {} : { matcher }),
    hooks: [
      {
        type: "command",
        command: hookCommand.command,
        ...(hookCommand.shell ? { shell: hookCommand.shell } : {}),
      },
    ],
    [MARKER]: true,
  };
}

/**
 * Ensure the agent's project-local hook config carries Mission Control's hook
 * entries. Existing user hooks are preserved; we only add, replace, or remove
 * entries tagged with our `_mcManaged` marker.
 */
export function installAgentHooks(
  agent: string | undefined,
  cwd: string,
  platform: NodeJS.Platform = process.platform
): void {
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

  const style = spec.style ?? "claude";
  if (style === "cursor") {
    settings.version = 1;
  }
  const hooks = (settings.hooks ??= {});
  for (const { event, matcher } of spec.events) {
    const command = buildHookCommand(spec.endpointSlug, event, style, platform);
    const groups = (hooks[event] ??= []);
    const filtered = groups.filter((g) => !g[MARKER]);
    filtered.push(buildManagedGroup(command, style, matcher));
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
