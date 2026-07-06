import { describe, expect, it } from "vitest";
import { isGraphSourceFile, languageForFile } from "../code-graph";

describe("languageForFile", () => {
  it("maps every indexed extension to its grammar", () => {
    expect(languageForFile("src/a.ts")).toBe("ts");
    expect(languageForFile("src/a.tsx")).toBe("tsx");
    expect(languageForFile("src/a.js")).toBe("js");
    expect(languageForFile("src/a.jsx")).toBe("jsx");
    // ESM/CJS variants share the ts/js grammars.
    expect(languageForFile("src/a.mts")).toBe("ts");
    expect(languageForFile("src/a.cts")).toBe("ts");
    expect(languageForFile("bundled-mcp/recall-mcp.mjs")).toBe("js");
    expect(languageForFile("src/a.cjs")).toBe("js");
    expect(languageForFile("pkg/app.py")).toBe("py");
  });

  it("rejects non-source files", () => {
    expect(languageForFile("README.md")).toBeNull();
    expect(languageForFile("data.json")).toBeNull();
    expect(languageForFile("script.pyc")).toBeNull();
    expect(isGraphSourceFile("a.wasm")).toBe(false);
    expect(isGraphSourceFile("a.py")).toBe(true);
    expect(isGraphSourceFile("a.mjs")).toBe(true);
  });
});
