import { describe, expect, it } from "vitest";
import { languageForFilename } from "../file-language";

describe("languageForFilename", () => {
  it("returns a language for .ts", () => {
    expect(languageForFilename("foo.ts").length).toBeGreaterThan(0);
  });
  it("returns a language for .tsx", () => {
    expect(languageForFilename("Foo.tsx").length).toBeGreaterThan(0);
  });
  it("returns a language for .js / .jsx / .mjs / .cjs", () => {
    expect(languageForFilename("a.js").length).toBeGreaterThan(0);
    expect(languageForFilename("a.jsx").length).toBeGreaterThan(0);
    expect(languageForFilename("a.mjs").length).toBeGreaterThan(0);
    expect(languageForFilename("a.cjs").length).toBeGreaterThan(0);
  });
  it("returns a language for package.json / .json", () => {
    expect(languageForFilename("package.json").length).toBeGreaterThan(0);
    expect(languageForFilename("tsconfig.json").length).toBeGreaterThan(0);
  });
  it("returns a language for .env / .env.local", () => {
    expect(languageForFilename(".env").length).toBeGreaterThan(0);
    expect(languageForFilename(".env.local").length).toBeGreaterThan(0);
  });

  it("returns a language for .sql", () => {
    expect(languageForFilename("schema.sql").length).toBeGreaterThan(0);
    expect(languageForFilename("db/migrations/0001_init.SQL").length).toBeGreaterThan(0);
  });

  it("returns a language for common structured formats", () => {
    for (const file of [
      "app.py",
      "styles.css",
      "styles.scss",
      "styles.sass",
      "styles.less",
      "index.html",
      "config.yaml",
      "config.yml",
      "Cargo.toml",
      "data.xml",
      "icon.svg",
      "assets/logo.SVG",
      "main.rs",
      "main.go",
      "Main.java",
      "index.php",
      "component.vue",
      "README.md",
    ]) {
      expect(languageForFilename(file), file).toHaveLength(1);
    }
  });

  it("returns a language for shell and script files", () => {
    expect(languageForFilename("deploy.sh").length).toBeGreaterThan(0);
    expect(languageForFilename("run.bash").length).toBeGreaterThan(0);
    expect(languageForFilename("Build.ps1").length).toBeGreaterThan(0);
    expect(languageForFilename("script.rb").length).toBeGreaterThan(0);
  });

  it("returns a language for extension-less known filenames", () => {
    expect(languageForFilename("Dockerfile").length).toBeGreaterThan(0);
    expect(languageForFilename("docker/Dockerfile.prod").length).toBeGreaterThan(0);
    expect(languageForFilename("Gemfile").length).toBeGreaterThan(0);
    expect(languageForFilename(".bashrc").length).toBeGreaterThan(0);
    expect(languageForFilename(".npmrc").length).toBeGreaterThan(0);
  });

  it("returns empty for unknown / plain-text extensions", () => {
    expect(languageForFilename("data.csv")).toEqual([]);
    expect(languageForFilename("notes.txt")).toEqual([]);
    expect(languageForFilename("LICENSE")).toEqual([]);
  });

  it("works with full paths", () => {
    expect(languageForFilename("src/foo/bar.ts").length).toBeGreaterThan(0);
    expect(languageForFilename("apps/api/.env").length).toBeGreaterThan(0);
    expect(languageForFilename("infra/db/schema.sql").length).toBeGreaterThan(0);
  });
});
