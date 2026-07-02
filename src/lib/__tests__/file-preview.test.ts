import { describe, expect, it } from "vitest";
import {
  buildHtmlPreviewSrcDoc,
  detectUnrenderableTemplate,
  isHtmlFilename,
  isMarkdownFilename,
} from "../file-preview";

describe("isMarkdownFilename", () => {
  it("detects markdown files by basename", () => {
    expect(isMarkdownFilename("README.md")).toBe(true);
    expect(isMarkdownFilename("docs/architecture.MD")).toBe(true);
    expect(isMarkdownFilename("notes.markdown")).toBe(true);
  });

  it("does not treat mdx or unrelated files as markdown preview files", () => {
    expect(isMarkdownFilename("component.mdx")).toBe(false);
    expect(isMarkdownFilename("README.md.bak")).toBe(false);
    expect(isMarkdownFilename("package.json")).toBe(false);
    expect(isMarkdownFilename(null)).toBe(false);
  });
});

describe("isHtmlFilename", () => {
  it("detects html files by basename", () => {
    expect(isHtmlFilename("index.html")).toBe(true);
    expect(isHtmlFilename("public/preview.HTM")).toBe(true);
  });

  it("does not treat unrelated files as html preview files", () => {
    expect(isHtmlFilename("component.xhtml")).toBe(false);
    expect(isHtmlFilename("index.html.bak")).toBe(false);
    expect(isHtmlFilename(undefined)).toBe(false);
  });
});

describe("buildHtmlPreviewSrcDoc", () => {
  it("injects a CSP into an existing head", () => {
    const doc = buildHtmlPreviewSrcDoc("<!doctype html><html><head><title>x</title></head><body></body></html>");
    expect(doc).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(doc).toContain("script-src 'none'");
    expect(doc).toContain("navigate-to 'none'");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<title>x</title>"));
  });

  it("wraps html fragments in a complete document", () => {
    const doc = buildHtmlPreviewSrcDoc("<main>Hello</main>");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<body><main>Hello</main></body>");
  });
});

describe("detectUnrenderableTemplate", () => {
  it("flags <include> build-time partials (webpack/posthtml)", () => {
    const src = `<!doctype html><html><body><include src="./partials/header.html" /></body></html>`;
    expect(detectUnrenderableTemplate(src)).toMatch(/include/i);
  });

  it("flags a TypeScript/JSX bundler entry (Vite)", () => {
    const src = `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
    expect(detectUnrenderableTemplate(src)).toMatch(/TypeScript|Vite/i);
  });

  it("flags a full doc that links no CSS/JS of its own but needs a build", () => {
    const src = `<!doctype html><html><body x-data="{}"><div class="flex bg-gray-900">Dashboard</div></body></html>`;
    expect(detectUnrenderableTemplate(src)).toMatch(/injected by a build/i);
  });

  it("does not flag a self-contained page", () => {
    const inlineStyled = `<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>Hi</h1></body></html>`;
    expect(detectUnrenderableTemplate(inlineStyled)).toBeNull();
    const withScript = `<!doctype html><html><body><h1>Hi</h1><script>document.title='x'</script></body></html>`;
    expect(detectUnrenderableTemplate(withScript)).toBeNull();
    const plain = `<main style="color:blue">Hello world</main>`;
    expect(detectUnrenderableTemplate(plain)).toBeNull();
  });
});
