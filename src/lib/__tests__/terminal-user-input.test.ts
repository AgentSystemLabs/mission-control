import { describe, expect, it } from "vitest";
import { isTerminalAutoReply } from "../terminal-user-input";

describe("isTerminalAutoReply", () => {
  it("treats terminal-generated replies as non-input", () => {
    expect(isTerminalAutoReply("\x1b[I")).toBe(true); // focus in
    expect(isTerminalAutoReply("\x1b[O")).toBe(true); // focus out
    expect(isTerminalAutoReply("\x1b[?1;2c")).toBe(true); // primary DA
    expect(isTerminalAutoReply("\x1b[>0;276;0c")).toBe(true); // secondary DA
    expect(isTerminalAutoReply("\x1b[24;80R")).toBe(true); // cursor position
    expect(isTerminalAutoReply("\x1b[?24;80;1R")).toBe(true); // DECXCPR
    expect(isTerminalAutoReply("\x1b[0n")).toBe(true); // DSR ok
    expect(isTerminalAutoReply("\x1b[?2026;2$y")).toBe(true); // DECRPM (sync output)
    expect(isTerminalAutoReply("\x1b[?0u")).toBe(true); // kitty flags
    expect(isTerminalAutoReply("\x1b]10;rgb:ff/ff/ff\x07")).toBe(true); // OSC color
    expect(isTerminalAutoReply("\x1bP1+r544e\x1b\\")).toBe(true); // DCS reply
    expect(isTerminalAutoReply("\x1b[O\x1b[?1;2c")).toBe(true); // combined
    expect(isTerminalAutoReply("")).toBe(true);
  });

  it("treats mouse reports as non-input", () => {
    expect(isTerminalAutoReply("\x1b[<0;12;34M")).toBe(true); // SGR press
    expect(isTerminalAutoReply("\x1b[<0;12;34m")).toBe(true); // SGR release
    expect(isTerminalAutoReply("\x1b[<35;40;10M")).toBe(true); // SGR motion
    expect(isTerminalAutoReply("\x1b[<64;5;5M\x1b[<64;5;6M")).toBe(true); // wheel
    expect(isTerminalAutoReply("\x1b[<0;12;34M\x1b[<0;12;34m")).toBe(true); // click
    expect(isTerminalAutoReply("\x1b[M !!")).toBe(true); // legacy X10
  });

  it("treats window-ops reports as non-input", () => {
    expect(isTerminalAutoReply("\x1b[48;45;120;900;1720t")).toBe(true); // in-band resize
    expect(isTerminalAutoReply("\x1b[4;900;1720t")).toBe(true); // XTWINOPS pixel size reply
    expect(isTerminalAutoReply("\x1b[48;45;120t\x1b[48;46;120t")).toBe(true); // resize burst
  });

  it("defaults unknown escape sequences to non-input", () => {
    expect(isTerminalAutoReply("\x1b[?997;1n")).toBe(true); // hypothetical future report
    expect(isTerminalAutoReply("\x1b[=5;1;2c")).toBe(true); // tertiary DA reply
    expect(isTerminalAutoReply("\x1b]52;c;YWJj\x1b\\")).toBe(true); // OSC 52 clipboard reply
    expect(isTerminalAutoReply("\x1bOG")).toBe(true); // SS3 non-key
  });

  it("treats key-encoding sequences and pastes as input", () => {
    expect(isTerminalAutoReply("\x1b[13u")).toBe(false); // kitty-encoded Enter
    expect(isTerminalAutoReply("\x1bOA")).toBe(false); // SS3 arrow (app cursor mode)
    expect(isTerminalAutoReply("\x1b[Z")).toBe(false); // shift-tab
    expect(isTerminalAutoReply("\x1b[200~pasted\x1b[201~")).toBe(false); // bracketed paste
    expect(isTerminalAutoReply("\x7f")).toBe(false); // backspace
  });

  it("treats real keystrokes as input", () => {
    expect(isTerminalAutoReply("a")).toBe(false);
    expect(isTerminalAutoReply("\r")).toBe(false); // Enter
    expect(isTerminalAutoReply(" ")).toBe(false); // Space
    expect(isTerminalAutoReply("\x1b[A")).toBe(false); // arrow up
    expect(isTerminalAutoReply("\x1b[B")).toBe(false); // arrow down
    expect(isTerminalAutoReply("\x1b[1;5C")).toBe(false); // ctrl+right
    expect(isTerminalAutoReply("\x1b[3~")).toBe(false); // delete
    expect(isTerminalAutoReply("\x1b")).toBe(false); // bare escape key
    expect(isTerminalAutoReply("hello")).toBe(false);
  });

  it("treats a mix of reply and keystroke as input", () => {
    expect(isTerminalAutoReply("\x1b[Ix")).toBe(false);
    expect(isTerminalAutoReply("\x1b[O\r")).toBe(false);
  });
});
