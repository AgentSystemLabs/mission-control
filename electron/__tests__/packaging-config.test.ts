import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  build?: {
    files?: string[];
  };
};

describe("electron-builder package config", () => {
  it("ships the TanStack production server bundle that Electron boots", () => {
    const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;

    expect(packageJson.build?.files).toContain("dist/**/*");
  });
});
