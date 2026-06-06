import { describe, expect, it } from "vitest";
import { extractRemoteVmDeployError } from "~/shared/remote-vm-deploy-error";

describe("extractRemoteVmDeployError", () => {
  it("returns the last remote-vm CLI error line", () => {
    const output = [
      "[remote-vm] starting deploy job abc",
      "[remote-vm] linked existing Railway project mission-control",
      "error: unexpected argument '--service' found",
      "[remote-vm] railway volume add --service foo failed: error: unexpected argument '--service' found",
    ].join("\n");

    expect(extractRemoteVmDeployError(output)).toBe(
      "railway volume add --service foo failed: error: unexpected argument '--service' found",
    );
  });

  it("falls back to bare CLI error lines", () => {
    expect(extractRemoteVmDeployError("stderr\nerror: not logged in\n")).toBe("error: not logged in");
  });
});
