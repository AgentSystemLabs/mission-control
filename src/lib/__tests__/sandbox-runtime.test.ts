import { describe, expect, it, vi } from "vitest";
import { isDockerSandboxRuntime, readSandboxRuntimeMode } from "../sandbox-runtime";

function electronWithState(status: string) {
  return {
    sandbox: {
      getState: vi.fn().mockResolvedValue({ status }),
    },
  } as never;
}

describe("sandbox-runtime", () => {
  it("treats an active sandbox scope as docker; Local/disabled as host", async () => {
    // Phase 2: a non-disabled active state means a sandbox scope is selected.
    await expect(isDockerSandboxRuntime(electronWithState("connected"))).resolves.toBe(true);
    await expect(isDockerSandboxRuntime(electronWithState("running"))).resolves.toBe(true);
    await expect(isDockerSandboxRuntime(electronWithState("disabled"))).resolves.toBe(false);
  });

  it("defaults to host when the Electron sandbox bridge is unavailable", async () => {
    await expect(readSandboxRuntimeMode(null)).resolves.toBe("host");
  });
});
