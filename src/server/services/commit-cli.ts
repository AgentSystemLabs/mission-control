import * as os from "node:os";
import { resolveAgentCommandOnPath } from "../../../electron/agent-cli-resolution";
import { sanitizedProcessEnv } from "../../../electron/shell-env";
import {
  COMMIT_CLI_VALUES,
  type CommitCli,
  type CommitCliDetection,
} from "~/shared/commit-cli";
import {
  readCommitCliSetting,
  writeCommitCliSetting,
} from "../controllers/settings.controller";
import { runCli } from "./claude-cli";

const COMMIT_MESSAGE_TIMEOUT_MS = 60_000;

function probeCli(
  binary: string,
  env: NodeJS.ProcessEnv = sanitizedProcessEnv(),
  platform: NodeJS.Platform = os.platform(),
): boolean {
  return resolveAgentCommandOnPath(binary, env, platform) !== null;
}

export function detectInstalledCommitClisFromEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform(),
): CommitCliDetection {
  return Object.fromEntries(
    COMMIT_CLI_VALUES.map((cli) => [cli, probeCli(cli, env, platform)] as const),
  ) as CommitCliDetection;
}

/** Probe every supported CLI and return the availability map.
 * Uses the same augmented PATH + alias resolver as session launch, so Windows
 * `.cmd` shims and Cursor's `agent.exe` alias are detected consistently. */
export async function detectInstalledCommitClis(): Promise<CommitCliDetection> {
  try {
    return detectInstalledCommitClisFromEnv(sanitizedProcessEnv());
  } catch (e) {
    console.error(
      `[commit-cli] detection batch failed: ${(e as Error)?.message ?? String(e)}`,
    );
    return Object.fromEntries(
      COMMIT_CLI_VALUES.map((cli) => [cli, false] as const),
    ) as CommitCliDetection;
  }
}

/** First detected CLI in priority order (= COMMIT_CLI_VALUES order), or null. */
export function pickPreferredCli(detection: CommitCliDetection): CommitCli | null {
  for (const cli of COMMIT_CLI_VALUES) {
    if (detection[cli]) return cli;
  }
  return null;
}

/**
 * Resolve the CLI to use for a ship attempt. If the user has an explicit
 * setting, return it (the spawn step will fail loudly if the binary is gone,
 * and the UI then routes the user to settings to switch).
 *
 * If no setting is persisted yet, run detection, pick the first available,
 * persist it so subsequent ships skip detection, and return it. When zero
 * CLIs are detected, return null — the caller decides how to surface that.
 *
 * The persisted-on-first-use behavior is the "auto-determine" requirement.
 */
export async function resolveCommitCli(): Promise<{
  cli: CommitCli | null;
  detection: CommitCliDetection | null;
  autoSeeded: boolean;
}> {
  const stored = readCommitCliSetting();
  if (stored) {
    console.info(`[commit-cli] using stored preference: ${stored}`);
    return { cli: stored, detection: null, autoSeeded: false };
  }
  // detectInstalledCommitClis already guarantees a typed shape on failure,
  // but be defensive in case its contract changes.
  let detection: CommitCliDetection;
  try {
    detection = await detectInstalledCommitClis();
  } catch (e) {
    console.error(
      `[commit-cli] unexpected detection error: ${(e as Error)?.message ?? String(e)}`,
    );
    return { cli: null, detection: null, autoSeeded: false };
  }
  const picked = pickPreferredCli(detection);
  if (picked) {
    writeCommitCliSetting(picked);
    console.info(`[commit-cli] auto-detected ${picked} on first ship`);
    return { cli: picked, detection, autoSeeded: true };
  }
  console.warn(
    `[commit-cli] no supported CLI found; detection: ${JSON.stringify(detection)}`,
  );
  return { cli: null, detection, autoSeeded: false };
}

/**
 * Per-CLI argument builder for the headless commit-message prompt. Each CLI
 * has its own non-interactive flag convention:
 *   - claude:        `claude -p <prompt>`
 *   - codex:         `codex exec <prompt>` (non-interactive single-shot)
 *   - cursor-agent:  `cursor-agent -p <prompt>`
 *   - opencode:      `opencode run <prompt>` (non-interactive single-shot)
 * Returns the (cmd, args) tuple that `runCli` then spawns through the login shell.
 */
function commandFor(cli: CommitCli, prompt: string): { cmd: string; args: string[] } {
  switch (cli) {
    case "claude":
      return { cmd: "claude", args: ["-p", prompt] };
    case "codex":
      return { cmd: "codex", args: ["exec", prompt] };
    case "cursor-agent":
      return { cmd: "cursor-agent", args: ["-p", prompt] };
    case "opencode":
      return { cmd: "opencode", args: ["run", prompt] };
  }
}

/** Carries the CLI identity alongside the error so the UI can render the modal. */
export class CommitMessageGenerationError extends Error {
  constructor(
    message: string,
    public readonly cli: CommitCli,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "CommitMessageGenerationError";
  }
}

const STDERR_TAIL_BYTES = 800;

/** Mask known credential shapes before stderr leaves the server — CLIs
 * occasionally echo API keys / bearer tokens / login URLs into stderr on
 * auth failure. We're already showing this to the user in the recovery
 * dialog, so trim aggressively. */
function redactSensitive(value: string): string {
  return value
    // Anthropic / OpenAI-style API keys
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "sk-<redacted>")
    // Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{12,}/gi, "Bearer <redacted>")
    // URL query strings carrying tokens
    .replace(/([?&](?:token|api_key|access_token|key)=)[^&\s"']+/gi, "$1<redacted>");
}

function sanitizeStderr(raw: string): string {
  const redacted = redactSensitive(raw);
  if (redacted.length <= STDERR_TAIL_BYTES) return redacted;
  return `…[truncated]\n${redacted.slice(-STDERR_TAIL_BYTES)}`;
}

/**
 * Spawn the configured CLI in headless print-mode with the staged-diff prompt
 * and return its stdout. Throws CommitMessageGenerationError on failure with
 * the CLI identity attached so the renderer can show "claude failed" vs
 * "codex failed" without the renderer having to know about settings.
 */
export async function runCommitCli(
  cli: CommitCli,
  prompt: string,
  options: { cwd: string },
): Promise<string> {
  const { cmd, args } = commandFor(cli, prompt);
  const startedAt = Date.now();
  try {
    const out = await runCli(cmd, args, {
      cwd: options.cwd,
      timeoutMs: COMMIT_MESSAGE_TIMEOUT_MS,
    });
    console.info(`[commit-cli] ${cli} succeeded in ${Date.now() - startedAt}ms`);
    return out;
  } catch (e) {
    const stderr = sanitizeStderr(e instanceof Error ? e.message : String(e));
    console.error(`[commit-cli] ${cli} failed after ${Date.now() - startedAt}ms`);
    throw new CommitMessageGenerationError(
      `failed to generate commit message via ${cli}`,
      cli,
      stderr,
    );
  }
}
