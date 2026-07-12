import * as path from "node:path";
import { writeOpencodeMissionControlPlugin } from "./opencode-mission-control-plugin";
import { readJsonSettingsFile, writeJsonSettingsFile } from "./json-settings-file";

const MARKER = "_mcManaged";

// injectContext: for this event, let the hook's HTTP response reach stdout so
// Claude Code injects it as additional turn context (used by proactive recall).
// Every other event discards stdout — the response is fire-and-forget status.
// gateSeconds: throttle the hook IN the shell command itself — a timestamp-file
// gate that exits before curl when fired again within the window. Keeps a
// high-frequency hook (the pet's PostToolUse) from POSTing on every tool call.
type HookEvent = { event: string; matcher?: string; injectContext?: boolean; gateSeconds?: number };
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
// pet is enabled (see installAgentHooks `opts.petEnabled`) and throttled
// in-command via gateSeconds so it never POSTs per tool call. Kept short so the
// pet feels alive mid-run — the per-line cooldowns in pet-messages.ts do the
// real spam control, this gate just caps the POST rate. Claude Code only —
// no other supported agent exposes PostToolUse.
const PET_TOOL_HOOK: HookEvent = {
  event: "PostToolUse",
  matcher: "Bash|Write|Edit",
  gateSeconds: 8,
};

// A timestamp-file gate prepended to a hook command so it exits before curl when
// re-fired inside the window. Fail-open: a bad/empty stamp just lets the POST
// through. $TMPDIR is per-user on macOS; /tmp is the POSIX fallback.
function posixCooldownGate(gateSeconds: number): string {
  return (
    'GATE="${TMPDIR:-/tmp}/mc-tool-react.$MC_TASK_ID"; ' +
    'NOW=$(date +%s); LAST=$(cat "$GATE" 2>/dev/null || echo 0); ' +
    `[ $((NOW-LAST)) -lt ${gateSeconds} ] 2>/dev/null && exit 0; ` +
    'echo "$NOW" > "$GATE" 2>/dev/null; '
  );
}

function buildPosixHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor",
  injectContext: boolean,
  gateSeconds?: number
): string {
  // Read stdin (the agent's hook payload JSON) and forward to Mission Control.
  // Fail-soft: never block the user's session if MC is down.
  const url = `"$MC_API_URL/api/hooks/${endpointSlug}?taskId=$MC_TASK_ID&hookEvent=${encodeURIComponent(event)}"`;
  if (style === "cursor") {
    return (
      'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ]; then printf \'{"continue":true}\\n\'; exit 0; fi; ' +
      "cat | curl -sS -m 3 -X POST " +
      '-H "Authorization: Bearer $MC_API_TOKEN" ' +
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
  const gate = gateSeconds ? posixCooldownGate(gateSeconds) : "";
  return (
    'if [ -z "$MC_TASK_ID" ] || [ -z "$MC_API_URL" ]; then exit 0; fi; ' +
    gate +
    "curl -sS -m 3 -X POST " +
    '-H "Authorization: Bearer $MC_API_TOKEN" ' +
    '-H "X-Mission-Control-Runtime: electron-local" ' +
    '-H "Content-Type: application/json" ' +
    "--data-binary @- " +
    `${url} ` +
    redirect
  );
}

// PowerShell counterpart of posixCooldownGate. Same fail-open contract.
function powershellCooldownGate(gateSeconds: number): string {
  return (
    '$gate = Join-Path $env:TEMP "mc-tool-react.$($env:MC_TASK_ID)"; ' +
    "$now = [int][double]::Parse((Get-Date -UFormat %s)); " +
    "$last = 0; if (Test-Path $gate) { try { $last = [int](Get-Content $gate -Raw -ErrorAction Stop) } catch {} }; " +
    `if (($now - $last) -lt ${gateSeconds}) { exit 0 }; ` +
    "try { Set-Content -Path $gate -Value $now -ErrorAction Stop } catch {}"
  );
}

function buildPowerShellHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor",
  injectContext: boolean,
  gateSeconds?: number
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
    ...(gateSeconds ? [powershellCooldownGate(gateSeconds)] : []),
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
  style: "claude" | "cursor",
  platform: NodeJS.Platform,
  injectContext: boolean,
  gateSeconds?: number
): HookCommand {
  if (platform === "win32" && style === "claude") {
    return {
      command: buildPowerShellHookCommand(endpointSlug, event, style, injectContext, gateSeconds),
      shell: "powershell",
    };
  }
  return { command: buildPosixHookCommand(endpointSlug, event, style, injectContext, gateSeconds) };
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
  opts?: { petEnabled?: boolean }
): void {
  if (!agent) return;
  if (agent === "opencode") {
    writeOpencodeMissionControlPlugin(cwd);
    return;
  }
  const spec = AGENT_HOOKS[agent];
  if (!spec) return;

  const file = path.join(cwd, ...spec.configPath);

  const settings = readJsonSettingsFile<HooksFile>(file);
  if (settings === null) return; // read failed (not just missing) — don't clobber

  const style = spec.style ?? "claude";
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
  for (const { event, matcher, injectContext, gateSeconds } of events) {
    const command = buildHookCommand(
      spec.endpointSlug,
      event,
      style,
      platform,
      injectContext ?? false,
      gateSeconds,
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
