import { describe, expect, it } from "vitest";
import { buildUpdateInvocation } from "../agent-cli-update";

describe("buildUpdateInvocation", () => {
  it("wraps posix commands in a shell -c invocation", () => {
    const invocation = buildUpdateInvocation("opencode upgrade", {}, "darwin");
    expect(invocation.args).toEqual(["-c", "opencode upgrade"]);
  });

  it("routes PowerShell pipelines to powershell on Windows", () => {
    const invocation = buildUpdateInvocation(
      "irm 'https://cursor.com/install?win32=true' | iex",
      { SystemRoot: "C:\\Windows" },
      "win32",
    );
    expect(invocation.file).toBe("powershell.exe");
    expect(invocation.args.at(-1)).toContain("| iex");
  });

  it("routes plain commands through cmd on Windows", () => {
    const invocation = buildUpdateInvocation(
      "npm i -g opencode-ai@latest",
      { SystemRoot: "C:\\Windows" },
      "win32",
    );
    expect(invocation.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(invocation.args).toEqual(["/d", "/s", "/c", "npm i -g opencode-ai@latest"]);
  });
});
