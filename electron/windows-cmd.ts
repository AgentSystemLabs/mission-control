import * as path from "node:path";

const WINDOWS_COMMAND_SCRIPT_EXTS = new Set([".bat", ".cmd"]);

export function isWindowsCommandScript(file: string): boolean {
  return WINDOWS_COMMAND_SCRIPT_EXTS.has(path.extname(file).toLowerCase());
}

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildCmdScriptCommand(binary: string, argv: readonly string[]): string {
  // `cmd /s /c` strips the first and last quote around the command string. Wrap
  // the whole invocation so the inner executable/argv quotes survive that pass.
  return `"${[quoteCmdArg(binary), ...argv.map(quoteCmdArg)].join(" ")}"`;
}
