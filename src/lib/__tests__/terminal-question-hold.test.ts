import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQuestionMenuHold,
  questionMenuSignatures,
} from "../terminal-question-hold";

const GAP = 50;

function makeHold(opts?: { maxHeldChars?: number }) {
  let signatures: string[] | null = null;
  const written: string[] = [];
  const hold = createQuestionMenuHold({
    getSignatures: () => signatures,
    write: (data) => written.push(data),
    frameGapMs: GAP,
    maxHeldChars: opts?.maxHeldChars,
  });
  return {
    hold,
    written,
    setQuestion: (pending: { questions: { question: string; header?: string }[] } | null) => {
      signatures = pending ? questionMenuSignatures(pending) : null;
    },
  };
}

const PENDING = {
  questions: [
    { question: "How would you like me to work during this session?", header: "Work style" },
  ],
};

// A realistic menu frame: erase-line/positioning sequences interleaved, the
// question text wrapped and column-jumped, plus the synthetic rows.
const MENU_FRAME =
  "\x1b[H\x1b[2K\x1b[1B\x1b[2K\x1b[1B" +
  "\x1b[2GHow\x1b[6Gwould\x1b[12Gyou like me to\r\n\x1b[2Gwork during this session?\r\n" +
  "\x1b[2G\x1b[38;5;153m1. Autonomous\x1b[39m\r\n2. Check in often\r\n" +
  "5. Type something.\r\n6. Chat about this\r\n" +
  "Enter to select \xb7 Tab/Arrow keys to navigate \xb7 Esc to cancel";

describe("questionMenuSignatures", () => {
  it("normalizes question text, header, and the fixed menu rows", () => {
    const sigs = questionMenuSignatures(PENDING);
    expect(sigs).toContain("Typesomething");
    expect(sigs).toContain("Chataboutthis");
    expect(sigs).toContain("Workstyle");
    // Truncated to a prefix that survives narrow panes, whitespace removed.
    expect(sigs).toContain("Howwouldyoulikemeto");
  });

  it("drops signatures too short to be distinctive", () => {
    const sigs = questionMenuSignatures({ questions: [{ question: "Ok?", header: "Go" }] });
    expect(sigs).not.toContain("Ok?");
    expect(sigs).not.toContain("Go");
    expect(sigs).toContain("Typesomething");
  });
});

describe("createQuestionMenuHold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes output straight through when no question is pending", () => {
    const t = makeHold();
    t.hold.write("a");
    t.hold.write("b");
    expect(t.written).toEqual(["a", "b"]);
  });

  it("lets non-menu frames flow while a question is pending", () => {
    const t = makeHold();
    t.setQuestion(PENDING);
    t.hold.write("streamed text before the tool call");
    vi.advanceTimersByTime(GAP);
    expect(t.written).toEqual(["streamed text before the tool call"]);
  });

  it("holds the frame that paints the menu, and everything after it", () => {
    const t = makeHold();
    t.setQuestion(PENDING);
    t.hold.write("last words.");
    vi.advanceTimersByTime(GAP);
    t.hold.write(MENU_FRAME);
    vi.advanceTimersByTime(GAP);
    t.hold.write("\x1b[2Khighlight-repaint");
    expect(t.written).toEqual(["last words."]);
    // Question resolves: the backlog fast-forwards in one write.
    t.setQuestion(null);
    t.hold.sync();
    expect(t.written).toEqual(["last words.", MENU_FRAME + "\x1b[2Khighlight-repaint"]);
  });

  it("holds a combined frame when text and menu arrive back-to-back (no partial erase)", () => {
    const t = makeHold();
    t.setQuestion(PENDING);
    t.hold.write("tail of the streamed text");
    vi.advanceTimersByTime(GAP - 10); // menu starts before the frame closes
    t.hold.write(MENU_FRAME);
    vi.advanceTimersByTime(GAP);
    expect(t.written).toEqual([]); // the whole burst held together
    t.setQuestion(null);
    t.hold.sync();
    expect(t.written).toEqual(["tail of the streamed text" + MENU_FRAME]);
  });

  it("engages on the fixed menu rows even if the question text is truncated away", () => {
    const t = makeHold();
    t.setQuestion(PENDING);
    t.hold.write("\x1b[2K1. A\r\n2. B\r\n3. Type something.\r\n");
    vi.advanceTimersByTime(GAP);
    expect(t.written).toEqual([]);
  });

  it("dismissal / desync flushes the menu back into the terminal", () => {
    const t = makeHold();
    t.setQuestion(PENDING);
    t.hold.write(MENU_FRAME);
    vi.advanceTimersByTime(GAP);
    expect(t.written).toEqual([]);
    t.setQuestion(null); // user pressed Esc — terminal owns the menu now
    t.hold.sync();
    expect(t.written).toEqual([MENU_FRAME]);
    t.hold.write("live again");
    expect(t.written).toEqual([MENU_FRAME, "live again"]);
  });

  it("drains an assembling frame before pass-through writes when the question clears", () => {
    const t = makeHold();
    t.setQuestion(PENDING);
    t.hold.write("buffered");
    t.setQuestion(null);
    t.hold.write("after"); // no sync() yet — ordering must still hold
    expect(t.written).toEqual(["buffered", "after"]);
  });

  it("fails open when the held backlog exceeds the cap", () => {
    const t = makeHold({ maxHeldChars: 30 });
    t.setQuestion(PENDING);
    t.hold.write(MENU_FRAME);
    vi.advanceTimersByTime(GAP);
    expect(t.written).toEqual([MENU_FRAME]); // over the cap: flushed, hold off
    t.hold.write("still flowing");
    expect(t.written).toEqual([MENU_FRAME, "still flowing"]);
    // Next question re-arms after the release signal.
    t.setQuestion(null);
    t.hold.sync();
    t.setQuestion(PENDING);
    t.hold.write("Type something.");
    vi.advanceTimersByTime(GAP);
    expect(t.written).toEqual([MENU_FRAME, "still flowing"]); // held again
  });

  it("dispose stops the frame timer", () => {
    const t = makeHold();
    t.setQuestion(PENDING);
    t.hold.write("pending frame");
    t.hold.dispose();
    vi.advanceTimersByTime(GAP * 2);
    expect(t.written).toEqual([]);
  });
});
