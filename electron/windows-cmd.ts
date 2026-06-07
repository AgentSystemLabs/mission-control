// Windows command-script quoting lives in src/shared/windows-cmd.ts as the
// single source of truth. Re-exported here to preserve existing electron/ +
// server import paths.
export {
  isWindowsCommandScript,
  buildCmdScriptCommand,
} from "../src/shared/windows-cmd";
