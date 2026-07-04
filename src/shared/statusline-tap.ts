import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Statusline tap — the local, zero-request source for Claude usage limits.
 *
 * Claude Code receives its plan rate-limit windows (`five_hour`, `seven_day`)
 * as `anthropic-ratelimit-unified-*` headers on every API response and passes
 * them to the configured statusline command inside the payload's `rate_limits`
 * field. Anthropic's OAuth usage endpoint (the only other source) is heavily
 * rate limited per account, so instead of polling it we install a wrapper
 * statusline that tees `rate_limits` into a shared cache file and then chains
 * the user's real statusline command so the visible statusline is unchanged.
 *
 * The cache file is deliberately tool-agnostic (~/.cache/claude-limits) so
 * other local consumers (e.g. the worktree-foreman dashboard) can read the
 * same snapshot instead of competing for the endpoint's per-account quota.
 */

export const SHARED_LIMITS_DIR = path.join(os.homedir(), ".cache", "claude-limits");
export const SHARED_LIMITS_FILE = path.join(SHARED_LIMITS_DIR, "limits.json");

const TAP_DIR = path.join(os.homedir(), ".claude", "mission-control");
export const STATUSLINE_TAP_PATH = path.join(TAP_DIR, "statusline-tap.sh");

/** Marker present in the managed statusLine command; also the recursion guard. */
const TAP_BASENAME = "statusline-tap.sh";

// The Python does the JSON work in one process: normalize + atomically write
// the shared cache, then print the user's own statusline command (from user
// settings) so the shell wrapper can chain it. Payload numbers: used_percentage
// is 0-100 (matching the OAuth endpoint's `utilization`); resets_at is unix
// seconds (the endpoint uses ISO-8601, so we normalize to ISO here).
const TAP_PYTHON = `
import json, os, sys, tempfile, datetime

def window(w):
    if not isinstance(w, dict):
        return None
    u = w.get("used_percentage")
    if not isinstance(u, (int, float)) or isinstance(u, bool):
        return None
    r = w.get("resets_at")
    iso = None
    if isinstance(r, (int, float)) and not isinstance(r, bool):
        iso = datetime.datetime.fromtimestamp(r, datetime.timezone.utc).isoformat()
    elif isinstance(r, str):
        iso = r
    return {"utilization": u, "resets_at": iso}

try:
    payload = json.load(sys.stdin)
except Exception:
    payload = {}

try:
    rl = payload.get("rate_limits") or {}
    out = {
        "five_hour": window(rl.get("five_hour")),
        "seven_day": window(rl.get("seven_day")),
        "source": "statusline",
        "written_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if out["five_hour"] or out["seven_day"]:
        d = os.path.expanduser("~/.cache/claude-limits")
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".limits-")
        with os.fdopen(fd, "w") as f:
            json.dump(out, f)
        os.replace(tmp, os.path.join(d, "limits.json"))
except Exception:
    pass

try:
    with open(os.path.expanduser("~/.claude/settings.json")) as f:
        cmd = (json.load(f).get("statusLine") or {}).get("command") or ""
    if "statusline-tap" not in cmd:
        sys.stdout.write(cmd)
except Exception:
    pass
`.trim();

/**
 * Bump the version comment whenever the script body changes; the installer
 * compares full file content, so this mostly documents intent for humans.
 */
export const STATUSLINE_TAP_SCRIPT = `#!/bin/sh
# Mission Control statusline tap v1 (managed - safe to delete; Mission Control reinstalls it).
# Tees Claude Code's rate_limits from the statusline payload into a shared cache
# (~/.cache/claude-limits/limits.json), then chains your own statusline command
# from ~/.claude/settings.json so the visible statusline is unchanged.
payload="$(cat)"
py="/usr/bin/python3"
command -v "$py" >/dev/null 2>&1 || py="python3"
chain="$(printf '%s' "$payload" | "$py" -c '${TAP_PYTHON}' 2>/dev/null)" || chain=""
if [ -n "$chain" ]; then
  printf '%s' "$payload" | sh -c "$chain"
fi
exit 0
`;

type StatusLineConfig = {
  type?: string;
  command?: string;
  padding?: number;
  refreshInterval?: number;
  [k: string]: unknown;
};

function readUserStatusLine(homedir: string): StatusLineConfig | null {
  try {
    const raw = fs.readFileSync(path.join(homedir, ".claude", "settings.json"), "utf8");
    const statusLine = (JSON.parse(raw) as { statusLine?: unknown }).statusLine;
    return statusLine && typeof statusLine === "object" ? (statusLine as StatusLineConfig) : null;
  } catch {
    return null;
  }
}

/** Write (or refresh) the tap script under ~/.claude/mission-control. */
export function ensureStatuslineTapScript(): string | null {
  try {
    let current: string | null = null;
    try {
      current = fs.readFileSync(STATUSLINE_TAP_PATH, "utf8");
    } catch {
      /* first install */
    }
    if (current !== STATUSLINE_TAP_SCRIPT) {
      fs.mkdirSync(TAP_DIR, { recursive: true });
      fs.writeFileSync(STATUSLINE_TAP_PATH, STATUSLINE_TAP_SCRIPT, { mode: 0o755 });
    }
    // An earlier install may predate the mode option taking effect on rewrite.
    fs.chmodSync(STATUSLINE_TAP_PATH, 0o755);
    return STATUSLINE_TAP_PATH;
  } catch {
    return null;
  }
}

/**
 * Point the project's `.claude/settings.local.json` statusLine at the tap.
 * A user-authored project statusLine (one that isn't the tap) is respected and
 * left untouched; the tap chains the *user-level* command at runtime, so the
 * global statusline (e.g. ccstatusline) keeps rendering as before.
 */
export function installManagedStatusLine(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir(),
  tapPath: string = STATUSLINE_TAP_PATH,
): void {
  if (platform === "win32") return; // the tap is a POSIX sh script

  const file = path.join(cwd, ".claude", "settings.local.json");
  let settings: { statusLine?: StatusLineConfig; [k: string]: unknown } = {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (raw.trim()) settings = JSON.parse(raw);
  } catch (err) {
    // ENOENT is expected on first install; any other error (parse failure,
    // permission denied) means we should not clobber the file.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return;
  }

  const existing = settings.statusLine;
  const existingCommand = typeof existing?.command === "string" ? existing.command : "";
  if (existing && !existingCommand.includes(TAP_BASENAME)) return;

  // Mirror the user's global statusline display knobs so wrapping ccstatusline
  // (or whatever they run) looks identical to running it directly.
  const userStatusLine = readUserStatusLine(homedir);
  const managed: StatusLineConfig = { type: "command", command: tapPath };
  if (typeof userStatusLine?.padding === "number") managed.padding = userStatusLine.padding;
  if (typeof userStatusLine?.refreshInterval === "number") {
    managed.refreshInterval = userStatusLine.refreshInterval;
  }

  settings.statusLine = managed;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — the indicator falls back to the endpoint fetcher.
  }
}

/** Ensure the tap script exists and the project statusLine points at it. */
export function ensureStatuslineTap(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") return;
  const tapPath = ensureStatuslineTapScript();
  if (!tapPath) return;
  installManagedStatusLine(cwd, platform, os.homedir(), tapPath);
}
