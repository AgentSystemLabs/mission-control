import type { Sandbox } from "@daytona/sdk";
import { isIP } from "node:net";
import {
  opencodeMissionControlPluginSource,
  OPENCODE_MISSION_CONTROL_PLUGIN_SEGMENTS,
} from "~/shared/opencode-mission-control-plugin";

const MARKER = "_mcManaged";

type HookEvent = { event: string; matcher?: string };
type HookEntry = {
  type: "command";
  command: string;
};
type ClaudeHookGroup = { matcher?: string; hooks: HookEntry[]; [MARKER]?: boolean };
type CursorHookGroup = { command: string; [MARKER]?: boolean };
type HookGroup = ClaudeHookGroup | CursorHookGroup;
type HooksFile = {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
};

type AgentHookSpec = {
  configPath: string[];
  endpointSlug: string;
  events: HookEvent[];
  style?: "claude" | "cursor";
  removeManagedEvents?: string[];
};

const AGENT_HOOKS: Record<string, AgentHookSpec> = {
  "claude-code": {
    configPath: [".claude", "settings.local.json"],
    endpointSlug: "claude",
    events: [
      { event: "UserPromptSubmit" },
      { event: "Stop" },
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

function joinRemotePath(...parts: string[]): string {
  return parts
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function dirname(remotePath: string): string {
  const idx = remotePath.lastIndexOf("/");
  return idx <= 0 ? "/" : remotePath.slice(0, idx);
}

function buildPosixHookCommand(
  endpointSlug: string,
  event: string,
  style: "claude" | "cursor",
): string {
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

function buildManagedGroup(
  command: string,
  style: "claude" | "cursor",
  matcher?: string,
): HookGroup {
  if (style === "cursor") return { command, [MARKER]: true };
  return {
    ...(matcher === undefined ? {} : { matcher }),
    hooks: [{ type: "command", command }],
    [MARKER]: true,
  };
}

async function readHooksFile(sandbox: Sandbox, file: string): Promise<HooksFile> {
  try {
    const buffer = await sandbox.fs.downloadFile(file);
    const text = buffer.toString("utf8");
    return text.trim() ? JSON.parse(text) as HooksFile : {};
  } catch {
    return {};
  }
}

async function installRemoteOpencodePlugin(
  sandbox: Sandbox,
  cwd: string,
): Promise<void> {
  const file = joinRemotePath(cwd, ...OPENCODE_MISSION_CONTROL_PLUGIN_SEGMENTS);
  await sandbox.fs.createFolder(dirname(file), "755").catch(() => undefined);
  await sandbox.fs.uploadFile(
    Buffer.from(opencodeMissionControlPluginSource(), "utf8"),
    file,
  );
}

export async function installRemoteAgentHooks(
  sandbox: Sandbox,
  opts: { agent?: string; cwd: string },
): Promise<void> {
  if (!opts.agent) return;
  if (opts.agent === "opencode") {
    await installRemoteOpencodePlugin(sandbox, opts.cwd);
    return;
  }
  const spec = AGENT_HOOKS[opts.agent];
  if (!spec) return;

  const file = joinRemotePath(opts.cwd, ...spec.configPath);
  const settings = await readHooksFile(sandbox, file);
  const style = spec.style ?? "claude";
  if (style === "cursor") settings.version = 1;
  const hooks = (settings.hooks ??= {});
  for (const { event, matcher } of spec.events) {
    const groups = (hooks[event] ??= []);
    const filtered = groups.filter((group) => !group[MARKER]);
    filtered.push(
      buildManagedGroup(
        buildPosixHookCommand(spec.endpointSlug, event, style),
        style,
        matcher,
      ),
    );
    hooks[event] = filtered;
  }
  for (const event of spec.removeManagedEvents ?? []) {
    const groups = hooks[event];
    if (!groups) continue;
    const filtered = groups.filter((group) => !group[MARKER]);
    if (filtered.length) hooks[event] = filtered;
    else delete hooks[event];
  }

  await sandbox.fs.createFolder(dirname(file), "755").catch(() => undefined);
  await sandbox.fs.uploadFile(Buffer.from(`${JSON.stringify(settings, null, 2)}\n`, "utf8"), file);
}

export function getHostedHookApiUrl(): string | null {
  const raw = process.env.MISSION_CONTROL_PUBLIC_URL?.trim() || null;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!isPublicHostname(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return false;
  if (host.startsWith("::ffff:")) {
    return isPublicIpv4(host.slice("::ffff:".length));
  }
  const family = isIP(host);
  if (family === 4) {
    return isPublicIpv4(host);
  }
  if (family === 6) {
    if (host === "::1" || host === "::") return false;
    if (host.startsWith("fc") || host.startsWith("fd")) return false;
    if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
      return false;
    }
    if (host.startsWith("2001:db8:")) return false;
    return true;
  }
  return true;
}

function isPublicIpv4(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const [a = 0, b = 0] = host.split(".").map((part) => Number(part));
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a >= 224) return false;
  return true;
}

