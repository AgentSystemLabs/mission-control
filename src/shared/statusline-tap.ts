import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readJsonSettingsFile, writeJsonSettingsFile } from "./json-settings-file";

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
//
// STALE-WRITE GUARD: every live session reruns the statusline on its refresh
// interval, but an idle session replays the headers of its LAST API response
// forever. With several sessions open, naive last-writer-wins makes the cache
// flap between snapshots that are hours apart. Guards, in order:
//   1. liveness — a session whose transcript hasn't changed in 10 min is idle;
//      its replayed data never writes (missing transcript_path fails open).
//   2. expired window — data whose session window already reset is junk.
//   3. account stamp — the cache records which Claude account (accountUuid in
//      ~/.claude.json) was logged in at write time. After /login the stamps
//      differ, and the fresh account's write wins unconditionally; the
//      monotonicity rules below only compare windows of the SAME account
//      (a new login legitimately reports lower utilization + earlier resets).
//   4. window monotonicity — within one window (identical resets_at)
//      utilization only ever grows. Two DIFFERENT unexpired windows under the
//      same stamp can only mean mixed tokens right after a login switch (a
//      real account never has two live 5h windows), so there the last live
//      writer wins and the flicker resolves as old sessions refresh tokens.
const TAP_PYTHON = `
import json, os, sys, tempfile, datetime

CACHE = os.path.expanduser("~/.cache/claude-limits/limits.json")

def parse_iso(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None

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

def current_account():
    try:
        with open(os.path.expanduser("~/.claude.json")) as f:
            acct = (json.load(f).get("oauthAccount") or {}).get("accountUuid")
        return acct if isinstance(acct, str) and acct else None
    except Exception:
        return None

def session_idle(payload, now):
    tp = payload.get("transcript_path")
    if not isinstance(tp, str) or not tp:
        return False  # no liveness signal: fail open, later guards still apply
    try:
        age = now.timestamp() - os.stat(tp).st_mtime
    except Exception:
        return False
    return age > 600

def is_stale(fh, now, acct):
    ra = parse_iso(fh.get("resets_at")) if fh else None
    if ra is not None and ra < now - datetime.timedelta(seconds=60):
        return True  # session window already reset: replayed data
    try:
        cur = json.load(open(CACHE))
    except Exception:
        return False
    if cur.get("account") != acct:
        return False  # different login (or unstamped cache): fresh write wins
    cfh = cur.get("five_hour") or {}
    cra = parse_iso(cfh.get("resets_at"))
    if cra is None:
        return False
    if ra is None:
        return cra > now  # cache has a live window; unknown-window data loses
    cu = cfh.get("utilization")
    if cra == ra and isinstance(cu, (int, float)) and fh and fh["utilization"] < cu:
        return True  # same window: utilization only ever grows
    return False  # different unexpired windows: mixed tokens, last writer wins

try:
    payload = json.load(sys.stdin)
except Exception:
    payload = {}

try:
    rl = payload.get("rate_limits") or {}
    fh = window(rl.get("five_hour"))
    sd = window(rl.get("seven_day"))
    now = datetime.datetime.now(datetime.timezone.utc)
    acct = current_account()
    if (fh or sd) and not session_idle(payload, now) and not is_stale(fh, now, acct):
        out = {
            "five_hour": fh,
            "seven_day": sd,
            "account": acct,
            "source": "statusline",
            "written_at": now.isoformat(),
        }
        d = os.path.dirname(CACHE)
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".limits-")
        with os.fdopen(fd, "w") as f:
            json.dump(out, f)
        os.replace(tmp, CACHE)
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
 * Bump on EVERY script change. The installer only overwrites an on-disk tap
 * whose version is <= this one, so an app running older code (the packaged
 * build vs a newer dev build, or a not-yet-restarted process) can never stomp
 * a newer script back to an old version on every session spawn.
 */
export const STATUSLINE_TAP_VERSION = 4;

export const STATUSLINE_TAP_SCRIPT = `#!/bin/sh
# Mission Control statusline tap v${STATUSLINE_TAP_VERSION} (managed - safe to delete; Mission Control reinstalls it).
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

function readTapVersion(content: string): number {
  const m = content.match(/statusline tap v(\d+)/);
  return m ? Number.parseInt(m[1], 10) : 0;
}

/** Write (or refresh) the tap script under ~/.claude/mission-control. */
export function ensureStatuslineTapScript(tapPath: string = STATUSLINE_TAP_PATH): string | null {
  try {
    let current: string | null = null;
    try {
      current = fs.readFileSync(tapPath, "utf8");
    } catch {
      /* first install */
    }
    // Never downgrade: another (newer) app build owns the script on disk.
    if (current !== null && readTapVersion(current) > STATUSLINE_TAP_VERSION) return tapPath;
    if (current !== STATUSLINE_TAP_SCRIPT) {
      fs.mkdirSync(path.dirname(tapPath), { recursive: true });
      fs.writeFileSync(tapPath, STATUSLINE_TAP_SCRIPT, { mode: 0o755 });
    }
    // An earlier install may predate the mode option taking effect on rewrite.
    fs.chmodSync(tapPath, 0o755);
    return tapPath;
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
  const settings = readJsonSettingsFile<{ statusLine?: StatusLineConfig; [k: string]: unknown }>(file);
  if (settings === null) return; // read failed (not just missing) — don't clobber

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
  // best-effort — the indicator falls back to the endpoint fetcher.
  writeJsonSettingsFile(file, settings);
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
