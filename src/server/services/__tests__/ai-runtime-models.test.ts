import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../claude-cli", () => ({
  runCli: vi.fn(),
}));

const { runCli } = await import("../claude-cli");
const {
  clearAiRuntimeModelCache,
  listAiRuntimeModels,
  parseCursorModelList,
  parseGrokModelList,
  parsePlainModelList,
} = await import("../ai-runtime-models");

describe("AI runtime model discovery", () => {
  beforeEach(() => {
    clearAiRuntimeModelCache();
    vi.mocked(runCli).mockReset();
  });

  it("parses Cursor's id-label model list", () => {
    expect(
      parseCursorModelList(`
Available models

auto - Auto
gpt-5.5-extra-high - GPT-5.5 Extra High
not a model line
`),
    ).toEqual([
      { id: "auto", label: "Auto" },
      { id: "gpt-5.5-extra-high", label: "GPT-5.5 Extra High" },
    ]);
  });

  it("parses OpenCode's one-model-per-line output", () => {
    expect(
      parsePlainModelList(`
opencode/big-pickle
anthropic/claude-sonnet-4-5
bad model with spaces
`),
    ).toEqual([
      { id: "opencode/big-pickle", label: "opencode/big-pickle" },
      {
        id: "anthropic/claude-sonnet-4-5",
        label: "anthropic/claude-sonnet-4-5",
      },
    ]);
  });

  it("parses Grok Build's authenticated model list", () => {
    expect(
      parseGrokModelList(`
You are logged in with grok.com.

Default model: grok-4.5

Available models:
  * grok-4.5 (default)
  - grok-4.1-fast
`),
    ).toEqual([
      { id: "grok-4.5", label: "grok-4.5" },
      { id: "grok-4.1-fast", label: "grok-4.1-fast" },
    ]);
  });

  it("only parses valid Grok Build bullets after the available-models heading", () => {
    expect(
      parseGrokModelList(`
* banner-version-that-is-not-a-model
grok-before-heading

Available models:
  * grok-4.5 (default)
  - custom/provider-model
  * grok-4.5
  * invalid model with spaces
  Default model: ignored
`),
    ).toEqual([
      { id: "grok-4.5", label: "grok-4.5" },
      { id: "custom/provider-model", label: "custom/provider-model" },
    ]);
  });

  it("returns no Grok Build models for malformed or heading-free output", () => {
    expect(parseGrokModelList("* grok-4.5 (default)\n")).toEqual([]);
    expect(parseGrokModelList("Available models:\n  * invalid model\n")).toEqual([]);
  });

  it("uses live Cursor models when the CLI list succeeds", async () => {
    vi.mocked(runCli).mockResolvedValueOnce("composer-2.5 - Composer 2.5\n");

    await expect(listAiRuntimeModels("cursor-cli")).resolves.toEqual({
      harness: "cursor-cli",
      source: "cli",
      models: [{ id: "composer-2.5", label: "Composer 2.5" }],
    });
  });

  it("uses live Grok Build models when discovery succeeds", async () => {
    vi.mocked(runCli).mockResolvedValueOnce(
      "Default model: grok-4.5\nAvailable models:\n  * grok-4.5 (default)\n",
    );

    await expect(listAiRuntimeModels("grok")).resolves.toEqual({
      harness: "grok",
      source: "cli",
      models: [{ id: "grok-4.5", label: "grok-4.5" }],
    });
    expect(runCli).toHaveBeenCalledWith("grok", ["models"], expect.any(Object));
  });

  it("falls back to the Grok Build catalog when discovery fails", async () => {
    vi.mocked(runCli).mockRejectedValueOnce(new Error("authentication required"));

    const result = await listAiRuntimeModels("grok");

    expect(result).toMatchObject({
      harness: "grok",
      source: "catalog",
      error: "model discovery failed",
    });
    expect(result.models).toContainEqual(expect.objectContaining({ id: "grok-4.5" }));
  });

  it("falls back to the catalog when live discovery fails", async () => {
    vi.mocked(runCli).mockRejectedValueOnce(new Error("missing cursor-agent sk-secret123456"));

    const result = await listAiRuntimeModels("cursor-cli");

    expect(result.harness).toBe("cursor-cli");
    expect(result.source).toBe("catalog");
    expect(result.error).toBe("model discovery failed");
    expect(result.models.some((model) => model.id === "composer-2.5")).toBe(true);
  });

  it("dedupes concurrent live discovery for the same harness", async () => {
    vi.mocked(runCli).mockResolvedValueOnce("composer-2.5 - Composer 2.5\n");

    await Promise.all([
      listAiRuntimeModels("cursor-cli"),
      listAiRuntimeModels("cursor-cli"),
    ]);

    expect(runCli).toHaveBeenCalledTimes(1);
  });
});
