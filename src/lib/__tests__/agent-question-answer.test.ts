import { describe, expect, it } from "vitest";
import {
  buildAnswerKeySequence,
  buildPayloadAnswerKeySequence,
  sanitizeFreeText,
  writeAnswerSequence,
} from "../agent-question-answer";

const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const ENTER = "\r";
const SPACE = " ";

const oneOf = { questionIndex: 0, questionCount: 1 };

describe("buildAnswerKeySequence", () => {
  it("submits the first option with a bare Enter", () => {
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [0],
        multiSelect: false,
        optionCount: 3,
        ...oneOf,
      })
    ).toEqual({ keys: [ENTER], needsSubmitConfirm: false });
  });

  it("navigates down to the target option before Enter", () => {
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [2],
        multiSelect: false,
        optionCount: 4,
        ...oneOf,
      })
    ).toEqual({ keys: [DOWN, DOWN, ENTER], needsSubmitConfirm: false });
  });

  it("clamps out-of-bounds indexes to the last option", () => {
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [9],
        multiSelect: false,
        optionCount: 3,
        ...oneOf,
      })
    ).toEqual({ keys: [DOWN, DOWN, ENTER], needsSubmitConfirm: false });
  });

  it("drops negative and non-integer indexes", () => {
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [-1, 1.5],
        multiSelect: false,
        optionCount: 3,
        ...oneOf,
      })
    ).toEqual({ keys: [], needsSubmitConfirm: false });
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [],
        multiSelect: false,
        optionCount: 3,
        ...oneOf,
      })
    ).toEqual({ keys: [], needsSubmitConfirm: false });
  });

  it("walks down toggling each selected option, then advances with right-arrow", () => {
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [0, 2],
        multiSelect: true,
        optionCount: 4,
        ...oneOf,
      })
    ).toEqual({ keys: [SPACE, DOWN, DOWN, SPACE, RIGHT], needsSubmitConfirm: true });
  });

  it("sorts and dedupes multi-select indexes", () => {
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [2, 0, 2],
        multiSelect: true,
        optionCount: 3,
        ...oneOf,
      })
    ).toEqual({ keys: [SPACE, DOWN, DOWN, SPACE, RIGHT], needsSubmitConfirm: true });
  });

  it("needs no confirm for a non-final question", () => {
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [1],
        multiSelect: false,
        optionCount: 3,
        questionIndex: 0,
        questionCount: 2,
      })
    ).toEqual({ keys: [DOWN, ENTER], needsSubmitConfirm: false });
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [0],
        multiSelect: true,
        optionCount: 3,
        questionIndex: 0,
        questionCount: 2,
      })
    ).toEqual({ keys: [SPACE, RIGHT], needsSubmitConfirm: false });
  });

  it("confirms the review screen after the final question of a multi-question payload", () => {
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [2],
        multiSelect: false,
        optionCount: 3,
        questionIndex: 1,
        questionCount: 2,
      })
    ).toEqual({ keys: [DOWN, DOWN, ENTER], needsSubmitConfirm: true });
    expect(
      buildAnswerKeySequence({
        kind: "options",
        optionIndexes: [1],
        multiSelect: true,
        optionCount: 3,
        questionIndex: 1,
        questionCount: 2,
      })
    ).toEqual({ keys: [DOWN, SPACE, RIGHT], needsSubmitConfirm: true });
  });

  it("navigates past the options to the Type-something row and types inline", () => {
    expect(
      buildAnswerKeySequence({
        kind: "freeText",
        text: "my custom reply",
        optionCount: 3,
        ...oneOf,
      })
    ).toEqual({
      keys: [DOWN, DOWN, DOWN, "my custom reply", ENTER],
      needsSubmitConfirm: false,
    });
  });

  it("free text confirms the review screen on the final question of a multi-question payload", () => {
    expect(
      buildAnswerKeySequence({
        kind: "freeText",
        text: "custom",
        optionCount: 2,
        questionIndex: 1,
        questionCount: 2,
      })
    ).toEqual({ keys: [DOWN, DOWN, "custom", ENTER], needsSubmitConfirm: true });
  });

  it("returns empty keys for unusable free text", () => {
    expect(
      buildAnswerKeySequence({ kind: "freeText", text: "  \r\n ", optionCount: 3, ...oneOf })
    ).toEqual({ keys: [], needsSubmitConfirm: false });
  });

  it("selects the Chat-about-this row below Type-something", () => {
    expect(
      buildAnswerKeySequence({ kind: "chat", optionCount: 3, ...oneOf })
    ).toEqual({ keys: [DOWN, DOWN, DOWN, DOWN, ENTER], needsSubmitConfirm: false });
    expect(
      buildAnswerKeySequence({
        kind: "chat",
        optionCount: 2,
        questionIndex: 0,
        questionCount: 2,
      })
    ).toEqual({ keys: [DOWN, DOWN, DOWN, ENTER], needsSubmitConfirm: false });
  });
});

describe("buildPayloadAnswerKeySequence", () => {
  it("plans a single-question payload as one step without confirm", () => {
    expect(
      buildPayloadAnswerKeySequence(
        [{ kind: "options", optionIndexes: [1], multiSelect: false }],
        [{ optionCount: 3 }],
      )
    ).toEqual({ steps: [[DOWN, ENTER]], needsSubmitConfirm: false });
  });

  it("plans one walk per question and confirms the trailing review screen", () => {
    expect(
      buildPayloadAnswerKeySequence(
        [
          { kind: "options", optionIndexes: [1], multiSelect: false },
          { kind: "options", optionIndexes: [0, 1], multiSelect: true },
        ],
        [{ optionCount: 2 }, { optionCount: 2 }],
      )
    ).toEqual({
      steps: [
        [DOWN, ENTER],
        [SPACE, DOWN, SPACE, RIGHT],
      ],
      needsSubmitConfirm: true,
    });
  });

  it("plans free text mid-payload against that question's own row layout", () => {
    expect(
      buildPayloadAnswerKeySequence(
        [
          { kind: "freeText", text: "custom" },
          { kind: "options", optionIndexes: [0], multiSelect: false },
        ],
        [{ optionCount: 2 }, { optionCount: 3 }],
      )
    ).toEqual({
      steps: [
        [DOWN, DOWN, "custom", ENTER],
        [ENTER],
      ],
      needsSubmitConfirm: true,
    });
  });

  it("lets a chat answer cancel early, walking prior answers to reach its tab", () => {
    expect(
      buildPayloadAnswerKeySequence(
        [{ kind: "options", optionIndexes: [0], multiSelect: false }, { kind: "chat" }],
        [{ optionCount: 2 }, { optionCount: 3 }],
      )
    ).toEqual({
      steps: [
        [ENTER],
        [DOWN, DOWN, DOWN, DOWN, ENTER],
      ],
      needsSubmitConfirm: false,
    });
  });

  it("rejects incomplete payloads without a trailing chat", () => {
    expect(
      buildPayloadAnswerKeySequence(
        [{ kind: "options", optionIndexes: [0], multiSelect: false }],
        [{ optionCount: 2 }, { optionCount: 2 }],
      )
    ).toBeNull();
    expect(buildPayloadAnswerKeySequence([], [{ optionCount: 2 }])).toBeNull();
  });

  it("rejects answers beyond the question count and chat mid-payload", () => {
    expect(
      buildPayloadAnswerKeySequence(
        [
          { kind: "options", optionIndexes: [0], multiSelect: false },
          { kind: "options", optionIndexes: [0], multiSelect: false },
        ],
        [{ optionCount: 2 }],
      )
    ).toBeNull();
    expect(
      buildPayloadAnswerKeySequence(
        [{ kind: "chat" }, { kind: "options", optionIndexes: [0], multiSelect: false }],
        [{ optionCount: 2 }, { optionCount: 2 }],
      )
    ).toBeNull();
  });

  it("rejects a payload containing an unusable answer", () => {
    expect(
      buildPayloadAnswerKeySequence(
        [
          { kind: "options", optionIndexes: [0], multiSelect: false },
          { kind: "freeText", text: "  \r\n " },
        ],
        [{ optionCount: 2 }, { optionCount: 2 }],
      )
    ).toBeNull();
  });
});

describe("sanitizeFreeText", () => {
  it("collapses newlines and strips control bytes", () => {
    expect(sanitizeFreeText("line one\r\nline two")).toBe("line one line two");
    expect(sanitizeFreeText("a\x1b[Bb\x07c")).toBe("a[Bbc");
    expect(sanitizeFreeText("  padded  ")).toBe("padded");
    expect(sanitizeFreeText("\r\n \t")).toBe("");
  });

  it("caps the length", () => {
    expect(sanitizeFreeText("x".repeat(9000))).toHaveLength(4000);
  });
});

describe("writeAnswerSequence", () => {
  it("writes every chunk in order", async () => {
    const written: string[] = [];
    await writeAnswerSequence((data) => written.push(data), [DOWN, DOWN, ENTER], 0);
    expect(written).toEqual([DOWN, DOWN, ENTER]);
  });

  it("handles an empty sequence", async () => {
    const written: string[] = [];
    await writeAnswerSequence((data) => written.push(data), [], 0);
    expect(written).toEqual([]);
  });
});
