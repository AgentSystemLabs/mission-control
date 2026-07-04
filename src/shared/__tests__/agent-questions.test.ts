import { describe, expect, it } from "vitest";
import { parseAskUserQuestionInput } from "../agent-questions";

describe("parseAskUserQuestionInput", () => {
  it("parses a realistic AskUserQuestion tool_input", () => {
    const parsed = parseAskUserQuestionInput({
      questions: [
        {
          question: "Which auth method?",
          header: "Auth",
          multiSelect: false,
          options: [
            { label: "OAuth", description: "Redirect flow" },
            { label: "JWT" },
          ],
        },
      ],
    });

    expect(parsed).toEqual([
      {
        question: "Which auth method?",
        header: "Auth",
        multiSelect: false,
        options: [
          { label: "OAuth", description: "Redirect flow" },
          { label: "JWT" },
        ],
      },
    ]);
  });

  it("preserves the multiSelect flag", () => {
    const parsed = parseAskUserQuestionInput({
      questions: [
        {
          question: "Pick features",
          multiSelect: true,
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    });
    expect(parsed?.[0]?.multiSelect).toBe(true);
    expect(parsed?.[0]?.header).toBeUndefined();
  });

  it("drops malformed questions and options", () => {
    const parsed = parseAskUserQuestionInput({
      questions: [
        { question: "", options: [{ label: "A" }] },
        { question: "No options", options: [] },
        { question: "Ok", options: [{ label: "  Keep  " }, { label: "" }, "junk", null] },
        "garbage",
        null,
      ],
    });

    expect(parsed).toEqual([
      { question: "Ok", multiSelect: false, options: [{ label: "Keep" }] },
    ]);
  });

  it("caps questions, options, and text length", () => {
    const option = { label: "x".repeat(5000) };
    const question = {
      question: "q",
      options: [option, option, option, option, option, option],
    };
    const parsed = parseAskUserQuestionInput({
      questions: [question, question, question, question, question, question],
    });

    expect(parsed).toHaveLength(4);
    expect(parsed?.[0]?.options).toHaveLength(4);
    expect(parsed?.[0]?.options[0]?.label).toHaveLength(2000);
  });

  it("returns null for unusable shapes", () => {
    expect(parseAskUserQuestionInput(null)).toBeNull();
    expect(parseAskUserQuestionInput("questions")).toBeNull();
    expect(parseAskUserQuestionInput({})).toBeNull();
    expect(parseAskUserQuestionInput({ questions: "nope" })).toBeNull();
    expect(parseAskUserQuestionInput({ questions: [] })).toBeNull();
    expect(parseAskUserQuestionInput({ questions: [{ question: "q", options: [] }] })).toBeNull();
  });
});
