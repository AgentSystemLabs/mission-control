import { describe, expect, it } from "vitest";
import {
  CUSTOM_SCRIPTS_MAX,
  SCRIPT_ARGS_MAX,
  isValidScriptArgName,
  normalizeScriptArgs,
  parseCustomScripts,
  serializeCustomScripts,
  substituteScriptArgs,
} from "../domain";

describe("parseCustomScripts", () => {
  it("returns [] for null/empty/non-JSON input", () => {
    expect(parseCustomScripts(null)).toEqual([]);
    expect(parseCustomScripts(undefined)).toEqual([]);
    expect(parseCustomScripts("")).toEqual([]);
    expect(parseCustomScripts("not json")).toEqual([]);
  });

  it("returns [] when the JSON is not an array", () => {
    expect(parseCustomScripts(JSON.stringify({ id: "a", name: "A", command: "x" }))).toEqual([]);
    expect(parseCustomScripts(JSON.stringify("a string"))).toEqual([]);
    expect(parseCustomScripts(JSON.stringify(42))).toEqual([]);
  });

  it("round-trips well-formed scripts in order", () => {
    const scripts = [
      { id: "a", name: "Test", command: "pnpm test" },
      { id: "b", name: "Build", command: "pnpm build" },
    ];
    expect(parseCustomScripts(JSON.stringify(scripts))).toEqual(scripts);
  });

  it("drops entries missing fields or with non-string fields", () => {
    const raw = JSON.stringify([
      { id: "ok", name: "Ok", command: "run" },
      { id: "missing-command", name: "Nope" },
      { name: "no-id", command: "run" },
      { id: 1, name: "bad-id-type", command: "run" },
      null,
      "garbage",
    ]);
    expect(parseCustomScripts(raw)).toEqual([{ id: "ok", name: "Ok", command: "run" }]);
  });

  it(`caps the list at CUSTOM_SCRIPTS_MAX (${CUSTOM_SCRIPTS_MAX})`, () => {
    const many = Array.from({ length: CUSTOM_SCRIPTS_MAX + 3 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      command: `cmd${i}`,
    }));
    const parsed = parseCustomScripts(JSON.stringify(many));
    expect(parsed).toHaveLength(CUSTOM_SCRIPTS_MAX);
    expect(parsed[0]).toEqual({ id: "s0", name: "S0", command: "cmd0" });
  });
});

describe("serializeCustomScripts", () => {
  it("returns null for an empty list", () => {
    expect(serializeCustomScripts([])).toBeNull();
  });

  it("round-trips with parseCustomScripts", () => {
    const scripts = [
      { id: "a", name: "Test", command: "pnpm test" },
      { id: "b", name: "Build", command: "pnpm build" },
    ];
    expect(parseCustomScripts(serializeCustomScripts(scripts))).toEqual(scripts);
  });
});

describe("custom script arguments", () => {
  it("round-trips scripts that declare args", () => {
    const scripts = [
      {
        id: "a",
        name: "Deploy",
        command: "lpd deploy --env $ENV",
        args: [{ name: "ENV", description: "Environment to deploy to" }],
      },
    ];
    expect(parseCustomScripts(serializeCustomScripts(scripts))).toEqual(scripts);
  });

  it("omits the args field entirely when a script has none", () => {
    const parsed = parseCustomScripts(
      JSON.stringify([{ id: "a", name: "Test", command: "pnpm test" }])
    );
    expect(parsed[0]).toEqual({ id: "a", name: "Test", command: "pnpm test" });
    expect("args" in parsed[0]!).toBe(false);
  });

  it("drops invalid arg names and de-dupes by name", () => {
    const raw = JSON.stringify([
      {
        id: "a",
        name: "Deploy",
        command: "deploy $ENV",
        args: [
          { name: "ENV", description: "ok" },
          { name: "1bad", description: "starts with digit" },
          { name: "has space", description: "has a space" },
          { name: "ENV", description: "duplicate, ignored" },
          { name: "", description: "blank" },
          "garbage",
          null,
        ],
      },
    ]);
    expect(parseCustomScripts(raw)[0]!.args).toEqual([
      { name: "ENV", description: "ok" },
    ]);
  });

  it("caps args at SCRIPT_ARGS_MAX", () => {
    const args = Array.from({ length: SCRIPT_ARGS_MAX + 5 }, (_, i) => ({
      name: `A${i}`,
    }));
    const parsed = parseCustomScripts(
      JSON.stringify([{ id: "a", name: "X", command: "run", args }])
    );
    expect(parsed[0]!.args).toHaveLength(SCRIPT_ARGS_MAX);
  });
});

describe("isValidScriptArgName", () => {
  it("accepts identifier-like names", () => {
    expect(isValidScriptArgName("ENV")).toBe(true);
    expect(isValidScriptArgName("_x")).toBe(true);
    expect(isValidScriptArgName("arg_2")).toBe(true);
  });

  it("rejects names that aren't valid identifiers", () => {
    expect(isValidScriptArgName("")).toBe(false);
    expect(isValidScriptArgName("1abc")).toBe(false);
    expect(isValidScriptArgName("has space")).toBe(false);
    expect(isValidScriptArgName("a-b")).toBe(false);
  });
});

describe("normalizeScriptArgs", () => {
  it("returns undefined for non-arrays and empty results", () => {
    expect(normalizeScriptArgs(null)).toBeUndefined();
    expect(normalizeScriptArgs("nope")).toBeUndefined();
    expect(normalizeScriptArgs([])).toBeUndefined();
    expect(normalizeScriptArgs([{ name: "" }, { name: "bad name" }])).toBeUndefined();
  });

  it("trims names and descriptions and omits blank descriptions", () => {
    expect(normalizeScriptArgs([{ name: "  ENV  ", description: "  hi  " }])).toEqual([
      { name: "ENV", description: "hi" },
    ]);
    expect(normalizeScriptArgs([{ name: "ENV", description: "   " }])).toEqual([
      { name: "ENV" },
    ]);
  });
});

describe("substituteScriptArgs", () => {
  it("replaces $name and ${name} placeholders", () => {
    expect(substituteScriptArgs("deploy --env $ENV", { ENV: "prod" })).toBe(
      "deploy --env prod"
    );
    expect(substituteScriptArgs("deploy --env ${ENV}x", { ENV: "prod" })).toBe(
      "deploy --env prodx"
    );
  });

  it("replaces every occurrence", () => {
    expect(substituteScriptArgs("$A and $A", { A: "x" })).toBe("x and x");
  });

  it("leaves tokens without a matching value untouched", () => {
    expect(substituteScriptArgs("echo $HOME --env $ENV", { ENV: "prod" })).toBe(
      "echo $HOME --env prod"
    );
  });

  it("does not re-expand a value that contains a placeholder", () => {
    expect(substituteScriptArgs("run $A", { A: "$B", B: "leak" })).toBe("run $B");
  });

  it("does not let a shorter name capture a longer token (prefix collision)", () => {
    expect(substituteScriptArgs("$ARG2", { ARG: "x", ARG2: "y" })).toBe("y");
  });
});
