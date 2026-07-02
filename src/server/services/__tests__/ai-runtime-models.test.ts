import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../claude-cli", () => ({
  runCli: vi.fn(),
}));

const { runCli } = await import("../claude-cli");
const {
  clearAiRuntimeModelCache,
  listAiRuntimeModels,
  parseCursorModelList,
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

  it("uses live Cursor models when the CLI list succeeds", async () => {
    vi.mocked(runCli).mockResolvedValueOnce("composer-2.5 - Composer 2.5\n");

    await expect(listAiRuntimeModels("cursor-cli")).resolves.toEqual({
      harness: "cursor-cli",
      source: "cli",
      models: [{ id: "composer-2.5", label: "Composer 2.5" }],
    });
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
