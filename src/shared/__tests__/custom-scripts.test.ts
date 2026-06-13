import { describe, expect, it } from "vitest";
import { CUSTOM_SCRIPTS_MAX, parseCustomScripts, serializeCustomScripts } from "../domain";

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
