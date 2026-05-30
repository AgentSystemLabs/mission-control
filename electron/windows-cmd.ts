// Moved to src/shared/windows-cmd.ts so the sandbox runner's mc-agent can reuse
// the same Windows command-script quoting without importing from electron/.
// Re-exported here to preserve existing electron/ + server import paths.
export {
  isWindowsCommandScript,
  buildCmdScriptCommand,
} from "../src/shared/windows-cmd";
