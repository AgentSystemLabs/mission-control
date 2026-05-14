import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectRow } from "../projects";
import {
  deleteRuntimeFile,
  executeRuntimeCommand,
  getRuntimeWorkspacePath,
  readRuntimeFileBuffer,
} from "../../runtime/daytona";

export const GIT_TIMEOUT_MS = 15_000;
export const PUSH_TIMEOUT_MS = 30_000;
export const COMMIT_MESSAGE_TIMEOUT_MS = 60_000;
/** Cap diff bodies so a giant lockfile diff can't lock the renderer. */
export const DIFF_MAX_BYTES = 2 * 1024 * 1024;
export const DIFF_MAX_LINES = 50_000;
/** Cap staged-diff payload sent to the AI commit message generator. */
export const COMMIT_MESSAGE_DIFF_BUDGET = 200_000;

export class GitError extends Error {
  constructor(message: string, public stderr?: string) {
    super(message);
    this.name = "GitError";
  }
}

export type RunGitResult = { stdout: string; stderr: string; code: number };

export type GitWorkspace = {
  kind: "local" | "daytona";
  cwd: string;
  runGit(args: string[], options?: { timeoutMs?: number }): Promise<RunGitResult>;
  readFile(relPath: string): Promise<Buffer>;
  deleteFile(relPath: string): Promise<void>;
};

export async function projectCwd(projectId: string): Promise<string> {
  const p = await getProjectRow(projectId);
  if (!p) throw new GitError("project not found");
  if (!p.path || !fs.existsSync(p.path)) {
    throw new GitError("project path does not exist on disk");
  }
  return p.path;
}

export async function getGitWorkspace(projectId: string): Promise<GitWorkspace> {
  const project = await getProjectRow(projectId);
  if (!project) throw new GitError("project not found");
  if (project.runtimeKind !== "local") {
    const cwd = await getRuntimeWorkspacePath(projectId);
    return {
      kind: "daytona",
      cwd,
      runGit: (args, options) => runDaytonaGit(projectId, cwd, args, options),
      readFile: (relPath) => readRuntimeFileBuffer(projectId, relPath),
      deleteFile: (relPath) => deleteRuntimeFile(projectId, relPath),
    };
  }
  const cwd = await projectCwd(projectId);
  return {
    kind: "local",
    cwd,
    runGit: (args, options) => runGit(cwd, args, options),
    readFile: async (relPath) => {
      const abs = resolveInside(cwd, relPath);
      return fs.promises.readFile(abs);
    },
    deleteFile: async (relPath) => {
      const abs = resolveInside(cwd, relPath);
      if (abs === cwd) throw new GitError("refusing to delete project root");
      await fs.promises.rm(abs, { force: false });
    },
  };
}

export function runGit(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; encoding?: "utf8" | "buffer" } = {},
): Promise<RunGitResult> {
  const { timeoutMs = GIT_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new GitError(`git ${args[0]} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => outChunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        code: code ?? 1,
      });
    });
  });
}

export async function gitOk(
  workspaceOrCwd: GitWorkspace | string,
  args: string[],
  timeoutMs?: number,
): Promise<string> {
  const r =
    typeof workspaceOrCwd === "string"
      ? await runGit(workspaceOrCwd, args, { timeoutMs })
      : await workspaceOrCwd.runGit(args, { timeoutMs });
  if (r.code !== 0) {
    throw new GitError(`git ${args[0]} failed`, r.stderr.trim() || `exit ${r.code}`);
  }
  return r.stdout;
}

export function combineStreams(r: RunGitResult): string {
  return [r.stdout, r.stderr].map((s) => s.trim()).filter(Boolean).join("\n");
}

function resolveInside(root: string, relPath: string): string {
  if (!relPath || relPath.trim() === "") throw new GitError("file path is required");
  const abs = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new GitError("path escapes project root");
  }
  return abs;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runDaytonaGit(
  projectId: string,
  cwd: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<RunGitResult> {
  const command = `out="$(mktemp)"; err="$(mktemp)"; git ${args.map(shellQuote).join(" ")} >"$out" 2>"$err"; code=$?; printf '__MC_GIT_CODE__%s\\n' "$code"; printf '__MC_GIT_STDOUT_B64__\\n'; base64 <"$out"; printf '\\n__MC_GIT_STDERR_B64__\\n'; base64 <"$err"; printf '\\n__MC_GIT_END__\\n'; rm -f "$out" "$err"; exit 0`;
  const response = await executeRuntimeCommand(projectId, command, {
    cwd,
    timeoutMs: options.timeoutMs ?? GIT_TIMEOUT_MS,
  });
  return parseDaytonaGitResponse(response.stdout);
}

export function parseDaytonaGitResponse(stdout: string): RunGitResult {
  const codeMatch = stdout.match(/__MC_GIT_CODE__(\d+)/);
  const outMatch = stdout.match(/__MC_GIT_STDOUT_B64__\n([\s\S]*?)\n__MC_GIT_STDERR_B64__/);
  const errMatch = stdout.match(/__MC_GIT_STDERR_B64__\n([\s\S]*?)\n__MC_GIT_END__/);
  if (!codeMatch || !outMatch || !errMatch) {
    return { stdout: "", stderr: stdout.trim() || "Daytona git command returned an unexpected response", code: 1 };
  }
  const decode = (value: string) => Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8");
  return {
    code: Number(codeMatch[1]),
    stdout: decode(outMatch[1] ?? ""),
    stderr: decode(errMatch[1] ?? ""),
  };
}

