// Classifies a PostToolUse hook payload into the Mission Pet's reaction
// vocabulary. Mirrors the split the pet's Bash|Write|Edit hook implies:
// Bash results are sniffed for what the command *did* (commit landed, tests
// failed, merge conflicted…), Write/Edit are classified by what kind of file
// the agent touched. Everything here is best-effort text sniffing — a miss
// just means the pet stays quiet, so patterns are tuned for low false
// positives over recall (a bare "failed" fires on "0 tests failed").

/** What a mid-turn tool call meant, in pet terms. */
export type PetToolKind =
  // Bash — something went wrong (specific first, generic last).
  | "merge-conflict"
  | "test-fail"
  | "type-error"
  | "build-fail"
  | "lint-fail"
  | "error"
  // Bash — something went right.
  | "commit"
  | "push"
  | "tests-pass"
  | "deploy"
  // Write|Edit — what kind of file the agent touched.
  | "edit-test"
  | "edit-styles"
  | "edit-docs"
  | "edit-config"
  | "edit-lockfile"
  | "edit-migration"
  // Nothing recognizable — the pet's routine "agent is working" signal.
  | "neutral";

export type PetToolSentiment = "error" | "success" | "neutral";

const ERROR_KINDS: ReadonlySet<PetToolKind> = new Set([
  "merge-conflict",
  "test-fail",
  "type-error",
  "build-fail",
  "lint-fail",
  "error",
]);

const SUCCESS_KINDS: ReadonlySet<PetToolKind> = new Set([
  "commit",
  "push",
  "tests-pass",
  "deploy",
]);

/** Collapse a kind to the coarse sentiment the pet's mood machinery uses. */
export function petToolSentiment(kind: PetToolKind): PetToolSentiment {
  if (ERROR_KINDS.has(kind)) return "error";
  if (SUCCESS_KINDS.has(kind)) return "success";
  return "neutral";
}

// How much of a tool result we scan — enough to catch a stack trace's first
// lines or a test summary without regexing megabytes of Bash output.
const TOOL_RESPONSE_SCAN_CAP = 8_000;

// Precise, low-false-positive error signatures (compiler/linter/runtime/CI).
// Bare "failed"/"not found" are deliberately excluded — they fire on normal
// output ("0 tests failed", "grep: not found") and would cry wolf.
const GENERIC_ERROR_RE =
  /\berror:|\bexception\b|\btraceback\b|\bpanicked at\b|\bfatal:|exit code [1-9]|Build failed|Failed to compile|ERROR in |compilation error|Command failed/i;

// Git's own conflict vocabulary — printed by merge, rebase, and cherry-pick.
const MERGE_CONFLICT_RE =
  /\bCONFLICT \(|Automatic merge failed|Merge conflict in |needs merge\b/;

// Failing counts from vitest/jest ("Tests: 2 failed"), generic "N tests
// failed" summaries, pytest ("2 failed,"), and assertion blowups. [1-9]
// leading digit keeps "0 failed" quiet.
const TEST_FAIL_RE =
  /\b[1-9]\d* (?:tests? |specs? )?fail(?:ed|ing)\b|Tests:\s*[1-9]\d* failed|\bFAIL\b\s+\S*(?:test|spec)|\bAssertionError\b/i;

// tsc ("error TS2345"), runtime TypeErrors, and Next/webpack "Type error:".
const TYPE_ERROR_RE = /error TS\d+|\bTypeError\b|Type error:/;

// Bundlers, cargo ("error[E0308]"), and generic compile failures.
const BUILD_FAIL_RE =
  /Build failed|Failed to compile|ERROR in |compilation error|error\[E\d+\]/;

// eslint's summary line ("✖ 3 problems (2 errors, ...)") and explicit
// "lint … error" phrasing.
const LINT_FAIL_RE = /✖ [1-9]\d* problems?|\blint\S*\b[^\n]*[1-9]\d* errors?/i;

// git commit's report line: "[branch abc1234] message".
const COMMIT_RE = /^\s*\[[^\]\n]+ [0-9a-f]{7,40}\] /m;

// git push's remote line: "To github.com:org/repo.git" / "To https://…".
const PUSH_RE = /^To (?:https?:\/\/|git@|ssh:\/\/|[\w.-]+[:/])\S+/m;

// Passing counts from vitest ("1636 passed"), mocha ("30 passing"), pytest.
const TESTS_PASS_RE = /\b[1-9]\d* pass(?:ed|ing)\b/i;
// …but only when the command actually looks like a test run: "passed" alone
// shows up in plenty of non-test output (CI status, linters, health checks).
const TEST_COMMAND_RE = /\b(?:vitest|jest|mocha|pytest|playwright|tape|ava|cargo test|go test|test)\b/i;

const DEPLOY_COMMAND_RE =
  /\b(?:wrangler (?:deploy|publish)|vercel|netlify deploy|firebase deploy|eb deploy|fly deploy|cdk deploy|terraform apply|kubectl apply|helm upgrade)\b/i;
const DEPLOY_RESPONSE_RE = /\bDeploy(?:ed|ment) (?:complete|successful|succeeded)\b/i;

const WRITE_EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const LOCKFILE_RE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/;
const TEST_FILE_RE =
  /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\//;
const STYLES_FILE_RE = /\.(?:css|scss|sass|less|styl)$/i;
const DOCS_FILE_RE = /\.(?:md|mdx|rst)$|(?:^|\/)README(?:\.\w+)?$/i;
const MIGRATION_FILE_RE = /(?:^|\/)migrations?\/|\.sql$/i;
const CONFIG_FILE_RE =
  /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|Dockerfile|Makefile|\.env[^/]*|[^/]*\.(?:ya?ml|toml|ini))$|\.config\.[cm]?[jt]s$|rc\.(?:json|[cm]?js)$/i;

function toolResponseText(toolResponse: unknown): string {
  if (toolResponse == null) return "";
  if (typeof toolResponse === "string") return toolResponse.slice(0, TOOL_RESPONSE_SCAN_CAP);
  if (typeof toolResponse === "object") {
    // Claude Code's Bash result is { stdout, stderr, … } — use the real output
    // (with its real newlines) so line-anchored patterns like git's
    // "[branch hash]" and "To remote" still match. JSON.stringify would
    // escape the newlines out of existence.
    const rec = toolResponse as Record<string, unknown>;
    const streams = [rec.stdout, rec.stderr, rec.output]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join("\n");
    if (streams) return streams.slice(0, TOOL_RESPONSE_SCAN_CAP);
  }
  try {
    return JSON.stringify(toolResponse).slice(0, TOOL_RESPONSE_SCAN_CAP);
  } catch {
    return "";
  }
}

function inputString(toolInput: unknown, key: string): string {
  if (toolInput == null || typeof toolInput !== "object") return "";
  const value = (toolInput as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function classifyFilePath(filePath: string): PetToolKind {
  if (!filePath) return "neutral";
  // Claude Code's Windows/PowerShell hooks report backslash paths
  // ("C:\repo\package.json", "src\__tests__\x.ts"). The rules below anchor on
  // "/" (leading (?:^|/) and [^/] classes), so a raw backslash path would fall
  // through or misclassify — normalize separators to "/" first.
  const path = filePath.replace(/\\/g, "/");
  if (LOCKFILE_RE.test(path)) return "edit-lockfile";
  if (TEST_FILE_RE.test(path)) return "edit-test";
  if (STYLES_FILE_RE.test(path)) return "edit-styles";
  if (DOCS_FILE_RE.test(path)) return "edit-docs";
  if (MIGRATION_FILE_RE.test(path)) return "edit-migration";
  if (CONFIG_FILE_RE.test(path)) return "edit-config";
  return "neutral";
}

function classifyBash(command: string, text: string, explicitError: boolean): PetToolKind {
  // Failures first — an errored command must never read as its success twin
  // (a conflicted merge still prints "To github.com" on the earlier push).
  if (MERGE_CONFLICT_RE.test(text)) return "merge-conflict";
  if (TEST_FAIL_RE.test(text)) return "test-fail";
  if (TYPE_ERROR_RE.test(text)) return "type-error";
  if (BUILD_FAIL_RE.test(text)) return "build-fail";
  if (LINT_FAIL_RE.test(text)) return "lint-fail";
  if (explicitError || GENERIC_ERROR_RE.test(text)) return "error";
  if (TESTS_PASS_RE.test(text) && TEST_COMMAND_RE.test(command || text)) return "tests-pass";
  if (COMMIT_RE.test(text)) return "commit";
  if (PUSH_RE.test(text)) return "push";
  if (DEPLOY_COMMAND_RE.test(command) || DEPLOY_RESPONSE_RE.test(text)) return "deploy";
  return "neutral";
}

/**
 * Classify a PostToolUse hook payload into the pet's reaction vocabulary.
 * Best-effort and fail-soft: anything unrecognized is "neutral".
 */
export function classifyPetToolUse(
  toolName: string,
  toolInput: unknown,
  toolResponse: unknown,
): PetToolKind {
  // A structured error flag wins over text sniffing regardless of tool.
  let explicitError = false;
  if (toolResponse != null && typeof toolResponse === "object") {
    const rec = toolResponse as Record<string, unknown>;
    explicitError = rec.isError === true || rec.is_error === true;
  }

  if (WRITE_EDIT_TOOLS.has(toolName)) {
    if (explicitError) return "error";
    return classifyFilePath(inputString(toolInput, "file_path"));
  }

  return classifyBash(
    inputString(toolInput, "command"),
    toolResponseText(toolResponse),
    explicitError,
  );
}
