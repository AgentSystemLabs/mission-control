import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readTranscriptForDistill } from "../recall-transcript";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-transcript-test-"));
const written: string[] = [];

function writeJsonl(records: unknown[]): string {
  const file = path.join(tmp, `t-${written.length}.jsonl`);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  written.push(file);
  return file;
}

afterEach(() => {
  for (const f of written.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
});

describe("readTranscriptForDistill", () => {
  it("renders user prompts, assistant text, tool_use and tool_result", () => {
    const file = writeJsonl([
      { type: "summary", summary: "ignored meta line" },
      { type: "user", message: { content: "wire up the code graph watcher" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "I'll add an fs.watch on the project root." },
            { type: "tool_use", name: "Write", input: { file_path: "src/server/graph-watcher.ts" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", content: [{ type: "text", text: "File created successfully" }] },
          ],
        },
      },
    ]);

    const out = readTranscriptForDistill(file, { charBudget: 8000 });
    expect(out).toContain("USER: wire up the code graph watcher");
    expect(out).toContain("ASSISTANT: I'll add an fs.watch on the project root.");
    expect(out).toContain("TOOL(Write): src/server/graph-watcher.ts");
    expect(out).toContain("RESULT: File created successfully");
    // Meta lines contribute nothing.
    expect(out).not.toContain("ignored meta line");
  });

  it("skips malformed JSON lines but keeps the valid ones", () => {
    const file = path.join(tmp, "mixed.jsonl");
    fs.writeFileSync(
      file,
      [
        "{ this is not json",
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "kept" }] } }),
        "",
      ].join("\n"),
      "utf8",
    );
    written.push(file);
    expect(readTranscriptForDistill(file, { charBudget: 8000 })).toBe("ASSISTANT: kept");
  });

  it("returns null for a missing file", () => {
    expect(readTranscriptForDistill(path.join(tmp, "nope.jsonl"), { charBudget: 8000 })).toBeNull();
  });

  it("returns null for an empty file", () => {
    const file = path.join(tmp, "empty.jsonl");
    fs.writeFileSync(file, "", "utf8");
    written.push(file);
    expect(readTranscriptForDistill(file, { charBudget: 8000 })).toBeNull();
  });

  it("returns null when nothing renders (only meta lines)", () => {
    const file = writeJsonl([{ type: "summary" }, { type: "system", content: "boot" }]);
    expect(readTranscriptForDistill(file, { charBudget: 8000 })).toBeNull();
  });

  it("keeps the tail when the content exceeds the char budget", () => {
    const records = Array.from({ length: 50 }, (_, i) => ({
      type: "assistant",
      message: { content: [{ type: "text", text: `line ${i} ${"x".repeat(50)}` }] },
    }));
    const file = writeJsonl(records);
    const out = readTranscriptForDistill(file, { charBudget: 200 });
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(202); // budget + the "…\n" marker
    expect(out).toContain("line 49"); // newest kept
    expect(out).not.toContain("line 0 "); // oldest dropped
  });
});
