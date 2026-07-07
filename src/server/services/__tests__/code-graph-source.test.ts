import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readNodeSource } from "../code-graph-source";

function makeRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-source-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const symbol = (filePath: string, startLine: number, endLine: number) => ({
  kind: "function" as const,
  filePath,
  startLine,
  endLine,
});

describe("readNodeSource", () => {
  it("returns the exact line range of a symbol", () => {
    const root = makeRoot({
      "src/a.ts": "const pad = 1;\nexport function a() {\n  return pad;\n}\nconst tail = 2;\n",
    });
    const source = readNodeSource(root, symbol("src/a.ts", 2, 4), 200);
    expect(source).not.toBeNull();
    expect(source!.text).toBe("export function a() {\n  return pad;\n}");
    expect(source!.startLine).toBe(2);
    expect(source!.endLine).toBe(4);
    expect(source!.truncated).toBe(false);
  });

  it("caps long symbols and flags truncation", () => {
    const body = Array.from({ length: 50 }, (_, i) => `  line${i + 1};`).join("\n");
    const root = makeRoot({ "big.ts": `function big() {\n${body}\n}\n` });
    const source = readNodeSource(root, symbol("big.ts", 1, 52), 10);
    expect(source!.truncated).toBe(true);
    expect(source!.endLine).toBe(10);
    expect(source!.text.split("\n")).toHaveLength(10);
  });

  it("reads file nodes from the top of the file (stored endLine is 1)", () => {
    const root = makeRoot({ "f.ts": "line one\nline two\nline three\n" });
    const source = readNodeSource(
      root,
      { kind: "file", filePath: "f.ts", startLine: 1, endLine: 1 },
      200,
    );
    expect(source!.text).toBe("line one\nline two\nline three");
    expect(source!.endLine).toBe(3);
    expect(source!.truncated).toBe(false);
  });

  it("refuses paths that escape the project root", () => {
    const root = makeRoot({ "a.ts": "x\n" });
    expect(readNodeSource(root, symbol("../outside.ts", 1, 1), 200)).toBeNull();
    expect(readNodeSource(root, symbol("/etc/hosts", 1, 1), 200)).toBeNull();
  });

  it("returns null for a missing file or a stale range past EOF", () => {
    const root = makeRoot({ "a.ts": "one line\n" });
    expect(readNodeSource(root, symbol("gone.ts", 1, 1), 200)).toBeNull();
    expect(readNodeSource(root, symbol("a.ts", 5, 9), 200)).toBeNull();
  });

  it("clamps an endLine past EOF to the last real line", () => {
    const root = makeRoot({ "a.ts": "one\ntwo\n" });
    const source = readNodeSource(root, symbol("a.ts", 1, 99), 200);
    expect(source!.text).toBe("one\ntwo");
    expect(source!.endLine).toBe(2);
    expect(source!.truncated).toBe(false);
  });
});
