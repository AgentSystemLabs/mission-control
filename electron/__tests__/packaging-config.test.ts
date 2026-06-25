import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  build?: {
    files?: string[];
    extraResources?: Array<{ from?: string; to?: string }>;
    mac?: { extendInfo?: Record<string, unknown> };
  };
};

function readPackageJson(): PackageJson {
  const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

describe("electron-builder package config", () => {
  it("ships the TanStack production server bundle that Electron boots", () => {
    expect(readPackageJson().build?.files).toContain("dist/**/*");
  });

  it("bundles the whisper voice-control resources into the app", () => {
    const entries = readPackageJson().build?.extraResources ?? [];
    const whisper = entries.find((e) => e.from === "resources/whisper");
    expect(whisper).toBeTruthy();
    // Resolved at runtime as process.resourcesPath/whisper in whisper-server.ts.
    expect(whisper?.to).toBe("whisper");
  });

  it("declares the macOS microphone usage string required for getUserMedia", () => {
    const extendInfo = readPackageJson().build?.mac?.extendInfo ?? {};
    expect(typeof extendInfo.NSMicrophoneUsageDescription).toBe("string");
  });
});
