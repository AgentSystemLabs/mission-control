import { describe, expect, it } from "vitest";
import { extractFile } from "../code-graph-extract";

describe("code-graph extraction", () => {
  it("extracts declarations, signatures, and export flags from TypeScript", async () => {
    const src = `
import { helper } from "./helper";
import * as pkg from "some-package";

export function alpha(a: number, b?: string): number {
  return helper(a);
}

const beta = (x: number): number => alpha(x);

export const gamma = () => beta(1);

export interface Widget { id: string; }
export type Id = string;

export class Engine {
  private q = 1;
  async run(): Promise<void> {
    helper(this.q);
  }
}
`;
    const ex = await extractFile(src, "ts");
    expect(ex.hadError).toBe(false);

    const byName = new Map(ex.symbols.map((s) => [s.name, s]));
    expect(byName.get("alpha")?.kind).toBe("function");
    expect(byName.get("alpha")?.exported).toBe(true);
    expect(byName.get("alpha")?.signature).toContain("a: number");
    expect(byName.get("alpha")?.signature).toContain("number");

    // Arrow-function-valued consts become `function` nodes.
    expect(byName.get("beta")?.kind).toBe("function");
    expect(byName.get("beta")?.exported).toBe(false);
    expect(byName.get("gamma")?.kind).toBe("function");
    expect(byName.get("gamma")?.exported).toBe(true);

    expect(byName.get("Widget")?.kind).toBe("interface");
    expect(byName.get("Id")?.kind).toBe("type");
    expect(byName.get("Engine")?.kind).toBe("class");
    expect(byName.get("run")?.kind).toBe("method");

    // Imports captured as specifiers (relative + package).
    const specs = ex.imports.map((i) => i.spec).sort();
    expect(specs).toContain("./helper");
    expect(specs).toContain("some-package");

    // Calls captured with callee names.
    const callNames = new Set(ex.calls.map((c) => c.calleeName));
    expect(callNames.has("helper")).toBe(true);
    expect(callNames.has("alpha")).toBe(true);
    expect(callNames.has("beta")).toBe(true);
  });

  it("attributes calls to their enclosing symbol", async () => {
    const src = `
function outer() { inner(); }
function inner() {}
`;
    const ex = await extractFile(src, "ts");
    const outer = ex.symbols.find((s) => s.name === "outer")!;
    const call = ex.calls.find((c) => c.calleeName === "inner");
    expect(call?.enclosingIndex).toBe(outer.index);
  });

  it("treats require() and dynamic import() as imports, not calls", async () => {
    const ex = await extractFile(
      `const x = require("cjs-mod");\nconst y = import("./dyn");`,
      "js",
    );
    const specs = ex.imports.map((i) => i.spec).sort();
    expect(specs).toContain("cjs-mod");
    expect(specs).toContain("./dyn");
    expect(ex.calls.some((c) => c.calleeName === "require")).toBe(false);
  });

  it("parses tsx without errors", async () => {
    const ex = await extractFile(
      `export const App = () => <div className="x">{go()}</div>;`,
      "tsx",
    );
    expect(ex.hadError).toBe(false);
    expect(ex.symbols.some((s) => s.name === "App")).toBe(true);
  });
});
