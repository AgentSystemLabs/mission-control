import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writeOpencodeMissionControlPlugin } from "./opencode-mission-control-plugin";
import { readJsonSettingsFile, writeJsonSettingsFile } from "./json-settings-file";

const MARKER = "_mcManaged";

// injectContext: for this event, let the hook's HTTP response reach stdout so
// Claude Code injects it as additional turn context (used by proactive recall).
// Every other event discards stdout — the response is fire-and-forget status.
type HookEvent = { event: string; matcher?: string; injectContext?: boolean };
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
  configRoot?: "project" | "grok-home";
  endpointSlug: string;
  events: HookEvent[];
  style?: "claude" | "cursor" | "grok";
  removeManagedEvents?: string[];
};

type HookCommand = {
  command: string;
  shell?: "powershell";
};

const GROK_POWERSHELL_BRIDGE = `param(
  [Parameter(Mandatory = $true, Position = 0)][string]$EndpointSlug,
  [Parameter(Mandatory = $true, Position = 1)][string]$HookEvent
)

$ErrorActionPreference = "SilentlyContinue"
if ([string]::IsNullOrWhiteSpace($env:MC_TASK_ID) -or [string]::IsNullOrWhiteSpace($env:MC_API_URL)) {
  exit 0
}

try {
  $payload = [Console]::In.ReadToEnd()
  $taskId = [System.Uri]::EscapeDataString($env:MC_TASK_ID)
  $eventName = [System.Uri]::EscapeDataString($HookEvent)
  $baseUrl = $env:MC_API_URL.TrimEnd("/")
  $url = "{0}/api/hooks/{1}?taskId={2}&hookEvent={3}" -f $baseUrl, $EndpointSlug, $taskId, $eventName
  $headers = @{
    Authorization = "Bearer $($env:MC_API_TOKEN)"
    "X-Mission-Control-Runtime" = "electron-local"
  }
  Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -ContentType "application/json" -TimeoutSec 3 -ErrorAction Stop | Out-Null
} catch {}

exit 0
`;

const AGENT_HOOKS: Record<string, AgentHookSpec> = {
  "claude-code": {
    configPath: [".claude", "settings.local.json"],
    endpointSlug: "claude",
    events: [
      // injectContext: the server answers this hook with a compact "relevant
      // memory + code" block that Claude injects into the turn (proactive recall).
      { event: "UserPromptSubmit", injectContext: true },
      { event: "Stop" },
      // SessionStart carries no status; the server hangs the code-graph
      // auto-index off it, and answers with the Session Brief as
      // additionalContext when the spawn-time file injection didn't land —
      // so the response must reach stdout (injectContext).
      { event: "SessionStart", injectContext: true },
      // PermissionRequest is the precise "human approval required" signal.
      // Notification also fires for idle reminders, so keep it narrowed to the
      // permission notification type for Claude builds that rely on it.
      { event: "PermissionRequest" },
      { event: "Notification", matcher: "permission_prompt" },
      // AskUserQuestion's choices only exist in the tool_input payload;
      // PreToolUse delivers them for the native overlay, PostToolUse marks
      // the question answered.
      { event: "PreToolUse", matcher: "AskUserQuestion" },
      { event: "PostToolUse", matcher: "AskUserQuestion" },
      // Background subagents outlive the foreground turn's Stop, so the
      // server tracks these to hold the session on "running" until the last
      // subagent reports in (see hooks.controller + subagent-activity).
      { event: "SubagentStart" },
      { event: "SubagentStop" },
    ],
    removeManagedEvents: ["UserInterrupt"],
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
  grok: {
    configPath: ["hooks", "mission-control.json"],
    configRoot: "grok-home",
    endpointSlug: "grok",
    style: "grok",
    events: [
      { event: "UserPromptSubmit" },
      { event: "Stop" },
      { event: "StopFailure" },
      { event: "SessionStart" },
      { event: "SessionEnd" },
      { event: "Notification", matcher: "permission_prompt" },
      { event: "PreToolUse", matcher: "ask_user_question" },
      { event: "PostToolUse", matcher: "ask_user_question" },
      { event: "SubagentStart" },
      { event: "SubagentStop" },
    ],
  },
  "cursor-cli": {
    configPath: [".cursor", "hooks.json"],
    endpointSlug: "cursor",
    style: "cursor",
    events: [
      // Installed for when CLI gains support; as of mid-2026 cursor-agent still
      // does not fire beforeSubmitPrompt (stop/sessionStart do). TerminalPane
      // uses an Enter→running fallback for Cursor sessions in the meantime.
      { event: "beforeSubmitPrompt" },
      { event: "sessionStart" },
      { event: "stop" },
      // Kept for IDE parity; still absent from cursor-agent CLI today.
      { event: "afterAgentResponse" },
    ],
  },
};

// The Mission Pet's mid-run signal: a broad PostToolUse scoped to the tools
// whose results are worth reacting to (Bash/Write/Edit). Installed ONLY when the
// pet is enabled (see installAgentHooks `opts.petEnabled`). It POSTs on every
// qualifying tool call: a shell-side time gate here would silently drop a
// meaningful result (a passing test, a landed commit) whenever it lands within
// the window of a routine neutral edit, so throttling lives server-side instead
// (hooks.controller `allowNeutralToolReact`), where the result is classified and
// only the neutral "agent is working" signal is rate-capped. This remains
// Claude-only because the pet's current tool classification is tuned to
// Claude's tool and result vocabulary.
const PET_TOOL_HOOK: HookEvent = {
  event: "PostToolUse",
  matcher: "Bash|Write|Edit",
};

function buildPosixHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor" | "grok",
  injectContext: boolean,
): string {
  // Read stdin (the agent's hook payload JSON) and forward to Mission Control.
  // Fail-soft: never block the user's session if MC is down.
  const apiUrl = "${MC_API_URL:-}";
  const taskId = "${MC_TASK_ID:-}";
  const url = `"${apiUrl}/api/hooks/${endpointSlug}?taskId=${taskId}&hookEvent=${encodeURIComponent(event)}"`;
  if (style === "cursor") {
    return (
      'if [ -z "${MC_TASK_ID:-}" ] || [ -z "${MC_API_URL:-}" ]; then printf \'{"continue":true}\\n\'; exit 0; fi; ' +
      "cat | curl -sS -m 3 -X POST " +
      '-H "Authorization: Bearer ${MC_API_TOKEN:-}" ' +
      '-H "X-Mission-Control-Runtime: electron-local" ' +
      '-H "Content-Type: application/json" ' +
      `--data-binary @- ${url} >/dev/null 2>&1 || true; ` +
      "printf '{\"continue\":true}\\n'"
    );
  }
  // injectContext events keep stdout (the JSON response Claude injects); all
  // others discard it. Either way stderr is dropped and a non-zero exit is
  // swallowed, so a slow/down server never blocks or faults the turn.
  const redirect = injectContext ? "2>/dev/null || true" : ">/dev/null 2>&1 || true";
  return (
    'if [ -z "${MC_TASK_ID:-}" ] || [ -z "${MC_API_URL:-}" ]; then exit 0; fi; ' +
    "curl -sS -m 3 -X POST " +
    '-H "Authorization: Bearer ${MC_API_TOKEN:-}" ' +
    '-H "X-Mission-Control-Runtime: electron-local" ' +
    '-H "Content-Type: application/json" ' +
    "--data-binary @- " +
    `${url} ` +
    redirect
  );
}

function buildPowerShellHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor" | "grok",
  injectContext: boolean,
): string {
  const eventParam = encodeURIComponent(event);
  const missingEnv =
    style === "cursor"
      ? 'if (-not $env:MC_TASK_ID -or -not $env:MC_API_URL) { Write-Output \'{"continue":true}\'; exit 0 }'
      : "if (-not $env:MC_TASK_ID -or -not $env:MC_API_URL) { exit 0 }";
  const continueOutput =
    style === "cursor" ? '; Write-Output \'{"continue":true}\'' : "";

  // injectContext: emit the JSON response to stdout (re-serialized) so Claude can
  // inject it; otherwise pipe to Out-Null. Both swallow errors (fail-soft).
  const invoke = injectContext
    ? 'try { $resp = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -ContentType "application/json" -TimeoutSec 3 -ErrorAction Stop; if ($resp) { $resp | ConvertTo-Json -Depth 10 -Compress } } catch {}'
    : 'try { Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -ContentType "application/json" -TimeoutSec 3 -ErrorAction Stop | Out-Null } catch {}';

  return [
    missingEnv,
    "$payload = [Console]::In.ReadToEnd()",
    "$taskId = [System.Uri]::EscapeDataString($env:MC_TASK_ID)",
    `$url = "$($env:MC_API_URL)/api/hooks/${endpointSlug}?taskId=$taskId&hookEvent=${eventParam}"`,
    '$headers = @{ Authorization = "Bearer $($env:MC_API_TOKEN)"; "X-Mission-Control-Runtime" = "electron-local" }',
    invoke + continueOutput,
  ].join("; ");
}

function buildHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor" | "grok",
  platform: NodeJS.Platform,
  injectContext: boolean,
  grokPowerShellBridge?: string,
): HookCommand {
  if (platform === "win32" && style === "grok" && grokPowerShellBridge) {
    return {
      command: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${grokPowerShellBridge}" ${endpointSlug} ${event}`,
    };
  }
  if (platform === "win32" && style !== "cursor") {
    return {
      command: buildPowerShellHookCommand(endpointSlug, event, style, injectContext),
      shell: "powershell",
    };
  }
  return { command: buildPosixHookCommand(endpointSlug, event, style, injectContext) };
}

function writeGrokPowerShellBridge(hooksDir: string): string | null {
  const file = path.join(hooksDir, "mission-control-hook.ps1");
  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(file, GROK_POWERSHELL_BRIDGE, "utf8");
    return file;
  } catch {
    return null;
  }
}

function buildManagedGroup(
  hookCommand: HookCommand,
  style: "claude" | "cursor" | "grok",
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

// A hook command that posts to Mission Control's own hook endpoint is ours by
// construction — $MC_TASK_ID / $MC_API_URL only exist inside MC-spawned
// sessions. Early installer versions wrote these entries WITHOUT the marker, so
// marker-only filtering let them accumulate as duplicates: each fires an extra
// POST per event, and for injectContext events the stale (stdout-discarding)
// copies race the managed hook server-side and swallow its one-shot output.
function isMissionControlCommand(command: unknown): boolean {
  return (
    typeof command === "string" &&
    command.includes("/api/hooks/") &&
    command.includes("MC_TASK_ID")
  );
}

function isMissionControlGroup(group: HookGroup): boolean {
  if (group[MARKER]) return true;
  const hooks = (group as ClaudeHookGroup).hooks;
  if (Array.isArray(hooks)) {
    return hooks.length > 0 && hooks.every((h) => isMissionControlCommand(h?.command));
  }
  return isMissionControlCommand((group as CursorHookGroup).command);
}

/**
 * Ensure the agent's project-local hook config carries Mission Control's hook
 * entries. Existing user hooks are preserved; we only add, replace, or remove
 * entries that are ours — tagged with the `_mcManaged` marker, or legacy
 * untagged entries recognized by their MC hook-endpoint command.
 */
export function installAgentHooks(
  agent: string | undefined,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  opts?: { petEnabled?: boolean; grokHome?: string }
): void {
  if (!agent) return;
  if (agent === "opencode") {
    writeOpencodeMissionControlPlugin(cwd);
    return;
  }
  const spec = AGENT_HOOKS[agent];
  if (!spec) return;

  const configuredGrokHome = opts?.grokHome?.trim() || process.env.GROK_HOME?.trim();
  const root =
    spec.configRoot === "grok-home"
      ? configuredGrokHome
        ? path.resolve(cwd, configuredGrokHome)
        : path.join(os.homedir(), ".grok")
      : cwd;
  const file = path.join(root, ...spec.configPath);

  const settings = readJsonSettingsFile<HooksFile>(file);
  if (settings === null) return; // read failed (not just missing) — don't clobber

  const style = spec.style ?? "claude";
  const grokPowerShellBridge =
    platform === "win32" && style === "grok"
      ? writeGrokPowerShellBridge(path.dirname(file))
      : undefined;
  if (platform === "win32" && style === "grok" && !grokPowerShellBridge) return;
  if (style === "cursor") {
    settings.version = 1;
  }
  // The pet's mid-run tool hook is Claude-only and appended ONLY when the pet is
  // enabled. Because install rebuilds all MC-managed groups per event from this
  // list, omitting it here also STRIPS a previously-installed pet group on the
  // next spawn — no separate removal path needed.
  const events =
    agent === "claude-code" && opts?.petEnabled ? [...spec.events, PET_TOOL_HOOK] : spec.events;
  const hooks = (settings.hooks ??= {});
  // Several spec entries can target the SAME event (e.g. two PostToolUse
  // matchers: AskUserQuestion + the pet's Bash|Write|Edit). Strip existing
  // MC-managed groups for an event only the FIRST time it's seen, then append
  // every managed group — otherwise the second entry would filter out the group
  // the first just added.
  const strippedEvents = new Set<string>();
  for (const { event, matcher, injectContext } of events) {
    const command = buildHookCommand(
      spec.endpointSlug,
      event,
      style,
      platform,
      injectContext ?? false,
      grokPowerShellBridge ?? undefined,
    );
    const groups = (hooks[event] ??= []);
    if (!strippedEvents.has(event)) {
      strippedEvents.add(event);
      hooks[event] = groups.filter((g) => !isMissionControlGroup(g));
    }
    hooks[event].push(buildManagedGroup(command, style, matcher));
  }

  for (const event of spec.removeManagedEvents ?? []) {
    const groups = hooks[event];
    if (!groups) continue;
    const filtered = groups.filter((g) => !isMissionControlGroup(g));
    if (filtered.length) hooks[event] = filtered;
    else delete hooks[event];
  }

  // best-effort - bubble up nothing; status will simply not update.
  writeJsonSettingsFile(file, settings);
}
