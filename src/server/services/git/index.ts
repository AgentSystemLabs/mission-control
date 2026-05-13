// Public surface of the git service. Re-exports preserve the original
// `~/server/services/git` import path after the file was split by responsibility.

export { GitError, gitErrorPayload } from "./exec";
export {
  parsePorcelainZ,
  getGitStatus,
  type GitFileStatus,
  type GitChangedFile,
  type GitStatus,
} from "./status";
export { getGitDiff, type GitDiff } from "./diff";
export {
  stageFiles,
  unstageFiles,
  deleteProjectFile,
  commit,
  push,
  type CommitResult,
  type PushResult,
} from "./commit";
