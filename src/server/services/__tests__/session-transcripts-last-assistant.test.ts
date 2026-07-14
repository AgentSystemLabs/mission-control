import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  setTranscriptPath,
  readLastAssistantText,
  __resetTranscriptPaths,
} from "../session-transcripts";

// Paths must live under ~/.claude/projects/ (setTranscriptPath containment),
// so the fixtures are written to the real directory and removed after.
const claudeProjects = path.join(os.homedir(), ".claude", "projects");
const transcriptFile = path.join(claudeProjects, "mc-last-assistant-test.jsonl");

const asst = (blocks: unknown[]) => JSON.stringify({ type: "assistant", message: { content: blocks } });
const user = (content: unknown) => JSON.stringify({ type: "user", message: { content } });

describe("readLastAssistantText", () => {
  beforeEach(() => {
    __resetTranscriptPaths();
    fs.mkdirSync(claudeProjects, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(transcriptFile, { force: true });
    __resetTranscriptPaths();
  });

  const write = (lines: string[]) => {
    fs.writeFileSync(transcriptFile, lines.join("\n") + "\n");
    setTranscriptPath("task-1", transcriptFile);
  };

  it("returns the last assistant message's text blocks", () => {
    write([
      user("earlier prompt"),
      asst([{ type: "text", text: "old response <!-- pet: stale -->" }]),
      user("do the thing"),
      asst([
        { type: "text", text: "Done." },
        { type: "tool_use", name: "Bash", input: {} },
      ]),
      asst([{ type: "text", text: "All wrapped up. <!-- pet: fresh -->" }]),
    ]);
    expect(readLastAssistantText("task-1")).toBe("All wrapped up. <!-- pet: fresh -->");
  });

  it("skips tool_use-only records to find the turn's prose", () => {
    write([
      user("go"),
      asst([{ type: "text", text: "the real text" }]),
      asst([{ type: "tool_use", name: "Bash", input: {} }]),
      // tool_result echoes come back as user records with tool_result blocks —
      // they are not a turn boundary.
      user([{ type: "tool_result", content: "ok" }]),
    ]);
    expect(readLastAssistantText("task-1")).toBe("the real text");
  });

  it("stops at the previous user prompt instead of resurfacing an older turn", () => {
    write([
      asst([{ type: "text", text: "previous turn's answer" }]),
      user("a new prompt"),
      asst([{ type: "tool_use", name: "Bash", input: {} }]),
    ]);
    expect(readLastAssistantText("task-1")).toBeNull();
  });

  it("survives torn/garbage lines and missing files", () => {
    write([
      user("go"),
      '{"type":"assistant","message":{"content":[{"type":"text","te', // torn write
      asst([{ type: "text", text: "intact" }]),
      "not json at all",
    ]);
    expect(readLastAssistantText("task-1")).toBe("intact");

    fs.rmSync(transcriptFile, { force: true });
    expect(readLastAssistantText("task-1")).toBeNull();
  });

  it("returns null when no transcript path was stashed", () => {
    expect(readLastAssistantText("unknown-task")).toBeNull();
  });
});
