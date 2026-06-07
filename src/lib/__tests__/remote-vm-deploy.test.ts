import { describe, expect, it } from "vitest";
import { extractRemoteVmDeployError } from "~/shared/remote-vm-deploy-error";

describe("extractRemoteVmDeployError", () => {
  it("returns the last remote-vm CLI error line", () => {
    const output = [
      "[remote-vm] starting deploy job abc",
      "[remote-vm] launching EC2 instance in us-east-1",
      "error: unexpected argument '--bad-flag' found",
      "[remote-vm] aws ec2 run-instances failed: error: unexpected argument '--bad-flag' found",
    ].join("\n");

    expect(extractRemoteVmDeployError(output)).toBe(
      "aws ec2 run-instances failed: error: unexpected argument '--bad-flag' found",
    );
  });

  it("falls back to bare CLI error lines", () => {
    expect(extractRemoteVmDeployError("stderr\nerror: not logged in\n")).toBe("error: not logged in");
  });
});
