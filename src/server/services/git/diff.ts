import { getErrorMessage } from "../../lib/errors";
import {
  DIFF_MAX_BYTES,
  DIFF_MAX_LINES,
  GitError,
  getGitWorkspace,
  gitOk,
  type GitWorkspace,
} from "./exec";

export type GitDiff =
  | { kind: "text"; patch: string; truncated: boolean }
  | { kind: "binary" }
  | { kind: "too-large"; lines: number; bytes: number }
  | { kind: "empty" };

/** Detect a binary patch by looking at the textual diff git emits. */
function isBinaryPatch(patch: string): boolean {
  return /^Binary files .* and .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch);
}

export async function getGitDiff(
  projectId: string,
  file: string,
  staged: boolean,
): Promise<GitDiff> {
  const workspace = await getGitWorkspace(projectId);

  // Untracked files have no index entry — `git diff` emits nothing. Synthesize
  // a unified-diff-style payload so the UI can render +lines for new files.
  if (!staged) {
    const statusOut = await gitOk(workspace, ["status", "--porcelain=v1", "-z", "--", file]);
    if (statusOut.startsWith("??")) {
      return readUntrackedAsDiff(workspace, file);
    }
  }

  const args = staged
    ? ["diff", "--cached", "--", file]
    : ["diff", "--", file];
  const r = await workspace.runGit(args);
  if (r.code !== 0) {
    throw new GitError("git diff failed", r.stderr.trim() || `exit ${r.code}`);
  }
  const patch = r.stdout;
  if (!patch.trim()) return { kind: "empty" };
  if (isBinaryPatch(patch)) return { kind: "binary" };

  const bytes = Buffer.byteLength(patch, "utf8");
  if (bytes > DIFF_MAX_BYTES) {
    const lines = patch.split("\n").length;
    return { kind: "too-large", lines, bytes };
  }
  const newlineCount = (patch.match(/\n/g) || []).length;
  if (newlineCount > DIFF_MAX_LINES) {
    return { kind: "too-large", lines: newlineCount, bytes };
  }
  return { kind: "text", patch, truncated: false };
}

/** Render an untracked file as a unified-diff-style patch (all lines as additions). */
async function readUntrackedAsDiff(workspace: GitWorkspace, file: string): Promise<GitDiff> {
  try {
    const buf = await workspace.readFile(file);
    if (buf.byteLength > DIFF_MAX_BYTES) {
      return { kind: "too-large", lines: 0, bytes: buf.byteLength };
    }
    // Cheap binary sniff: any NUL in the first 8KB.
    const sniff = buf.subarray(0, Math.min(buf.length, 8192));
    for (let i = 0; i < sniff.length; i++) {
      if (sniff[i] === 0) return { kind: "binary" };
    }
    const text = buf.toString("utf8");
    const lines = text.split("\n");
    if (lines.length > DIFF_MAX_LINES) {
      return { kind: "too-large", lines: lines.length, bytes: buf.byteLength };
    }
    const header =
      `diff --git a/${file} b/${file}\n` +
      `new file\n` +
      `--- /dev/null\n` +
      `+++ b/${file}\n` +
      `@@ -0,0 +1,${lines.length} @@\n`;
    const body = lines.map((l) => `+${l}`).join("\n");
    return { kind: "text", patch: header + body, truncated: false };
  } catch (e: unknown) {
    throw new GitError("could not read untracked file", getErrorMessage(e));
  }
}
