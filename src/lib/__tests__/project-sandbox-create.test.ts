import { describe, expect, it } from "vitest";
import {
  buildProjectSandboxSetupCommand,
  projectSandboxBaseBranch,
  projectSandboxPathName,
  waitForSandboxSetupReady,
} from "../project-sandbox-create";
import type { ElectronBridge } from "../electron";
import { setupCommandNeedsPackageJson } from "../setup-command";

describe("projectSandboxPathName", () => {
  it("uses the last path segment", () => {
    expect(projectSandboxPathName("/Users/dev/mission-control", "fallback")).toBe("mission-control");
  });
});

describe("projectSandboxBaseBranch", () => {
  it("falls back to main when blank", () => {
    expect(projectSandboxBaseBranch({ baseBranch: "  " })).toBe("main");
  });

  it("trims the configured branch", () => {
    expect(projectSandboxBaseBranch({ baseBranch: " develop " })).toBe("develop");
  });
});

describe("buildProjectSandboxSetupCommand", () => {
  it("returns null when there is no init command", () => {
    expect(
      buildProjectSandboxSetupCommand({
        name: "sandbox",
        baseBranch: "main",
        bootCommand: "",
        initCommand: "  ",
        copyEnvFiles: true,
        imageStrategy: "golden",
      }),
    ).toBeNull();
  });

  it("runs only the init command after clone", () => {
    expect(
      buildProjectSandboxSetupCommand({
        name: "sandbox",
        baseBranch: "develop",
        bootCommand: "",
        initCommand: "npm i",
        copyEnvFiles: true,
        imageStrategy: "golden",
      }),
    ).toBe("set -e\nnpm i");
  });
});

describe("waitForSandboxSetupReady", () => {
  it("waits for package.json before npm setup commands", async () => {
    let packageReads = 0;
    const electron = {
      remoteGit: {
        status: async () => ({ branch: "main", staged: [], unstaged: [], changedCount: 0, aheadCount: 0 }),
      },
      remoteFs: {
        read: async () => {
          packageReads += 1;
          return packageReads < 2
            ? { ok: false as const, error: "not found" }
            : { ok: true as const, kind: "text" as const, content: "{}", mtimeMs: Date.now(), lineCount: 1 };
        },
      },
    };

    await waitForSandboxSetupReady(electron as unknown as ElectronBridge, "/workspace/project", "set -e\nnpm i", 2_000);

    expect(packageReads).toBe(2);
  });
});

describe("setupCommandNeedsPackageJson", () => {
  it("detects common package-manager install commands", () => {
    expect(setupCommandNeedsPackageJson("npm i")).toBe(true);
    expect(setupCommandNeedsPackageJson("npm ci")).toBe(true);
    expect(setupCommandNeedsPackageJson("corepack pnpm install")).toBe(true);
    expect(setupCommandNeedsPackageJson("cd app && npm install")).toBe(true);
    expect(setupCommandNeedsPackageJson("echo ok; yarn install")).toBe(true);
  });

  it("does not require package.json for unrelated setup commands", () => {
    expect(setupCommandNeedsPackageJson("python -m pip install -r requirements.txt")).toBe(false);
  });
});
