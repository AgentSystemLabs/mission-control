/**
 * Suppresses the TUI's own AskUserQuestion menu in the terminal while the
 * popup overlay (AskUserQuestionOverlay) is the answering surface — WITHOUT
 * hiding the transcript: the terminal stays readable and scrollable while a
 * question is pending.
 *
 * PTY output can't be selectively dropped — repaint frames are relative to
 * the current screen state, so skipping any of them corrupts everything that
 * follows. Instead the terminal freezes at the last pre-menu frame: output is
 * assembled into frames (bursts separated by a quiet gap), each completed
 * frame is scanned, and the first frame that paints the pending question's
 * menu — matched by the question's own text (known from the hook payload)
 * plus the menu's fixed row labels — engages a hold. Everything from that
 * frame on buffers, then flushes as ONE write when the question resolves, so
 * xterm parses the backlog in a batch and the screen fast-forwards straight
 * to the post-answer state.
 *
 * Frames without a menu signature keep flowing (delayed only by the gap), so
 * text the agent streams right up to the tool call still lands on screen —
 * and a mid-frame freeze (erase chunk painted, redraw chunk held → blank
 * screen) can't happen, because whole frames render or hold together.
 */

/** Quiet time on the output stream that separates two repaint frames. */
export const QUESTION_FRAME_GAP_MS = 50;

/** Fail-open cap: a hold this large means the release signal was lost. */
export const QUESTION_HOLD_MAX_CHARS = 2_000_000;

// CSI / OSC / DCS / lone escapes — stripped before signature matching.
const ANSI_RE =
  /\x1b\[[0-9:;<=>?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[\s\S]*?\x1b\\|\x1b[@-_]/g;

/**
 * TUI paints interleave positioning and styling sequences into the text and
 * wrap it at arbitrary columns, so matching normalizes both sides down to the
 * bare glyphs: ANSI stripped, all whitespace removed.
 */
function normalizeForMatch(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\s+/g, "");
}

/** Rows the AskUserQuestion menu always paints, plus per-payload texts. */
const MENU_ROW_SIGNATURES = ["Type something", "Chat about this", "Enter to select"];

/** Question-text prefix short enough to survive narrow-pane truncation. */
const QUESTION_SIGNATURE_CHARS = 24;

/** Minimum normalized length — refuse signatures too short to be distinctive. */
const MIN_SIGNATURE_CHARS = 6;

export function questionMenuSignatures(pending: {
  questions: { question: string; header?: string }[];
}): string[] {
  const raw = [...MENU_ROW_SIGNATURES];
  for (const q of pending.questions) {
    raw.push(q.question.slice(0, QUESTION_SIGNATURE_CHARS));
    if (q.header) raw.push(q.header);
  }
  return raw
    .map(normalizeForMatch)
    .filter((sig) => sig.length >= MIN_SIGNATURE_CHARS);
}

export interface QuestionMenuHold {
  /** Route a PTY output chunk through the hold. */
  write(data: string): void;
  /** Re-check the store; flushes the backlog once the question resolved. */
  sync(): void;
  /** Stop the frame timer — call from surface teardown. */
  dispose(): void;
}

export function createQuestionMenuHold(opts: {
  /** Menu signatures of the question being answered in the popup, or null. */
  getSignatures: () => string[] | null;
  write: (data: string) => void;
  frameGapMs?: number;
  maxHeldChars?: number;
}): QuestionMenuHold {
  const frameGapMs = opts.frameGapMs ?? QUESTION_FRAME_GAP_MS;
  const maxHeldChars = opts.maxHeldChars ?? QUESTION_HOLD_MAX_CHARS;

  // The frame currently assembling (question pending, menu not seen yet).
  let frame: string[] = [];
  let frameChars = 0;
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  // Everything from the menu frame on, buffered until the question resolves.
  let held: string[] = [];
  let heldChars = 0;
  let engaged = false;
  // Fail-open latch: stop holding for this question rather than jam output.
  let broken = false;

  const clearFrameTimer = () => {
    if (frameTimer !== null) {
      clearTimeout(frameTimer);
      frameTimer = null;
    }
  };

  /** Everything buffered, in arrival order, as one write. */
  const flushAll = () => {
    clearFrameTimer();
    const backlog = held.join("") + frame.join("");
    held = [];
    heldChars = 0;
    frame = [];
    frameChars = 0;
    if (backlog) opts.write(backlog);
  };

  const failOpen = () => {
    broken = true;
    engaged = false;
    flushAll();
  };

  const hold = (data: string) => {
    held.push(data);
    heldChars += data.length;
    if (heldChars > maxHeldChars) failOpen();
  };

  const onFrameComplete = () => {
    frameTimer = null;
    const complete = frame.join("");
    frame = [];
    frameChars = 0;
    if (!complete) return;
    const signatures = broken ? null : opts.getSignatures();
    const paintsMenu =
      !!signatures &&
      (() => {
        const normalized = normalizeForMatch(complete);
        return signatures.some((sig) => normalized.includes(sig));
      })();
    if (paintsMenu) {
      engaged = true;
      hold(complete);
    } else {
      opts.write(complete);
    }
  };

  return {
    write(data) {
      if (broken || !opts.getSignatures()) {
        // No active question (or failed open): drain anything buffered first
        // so ordering holds, then pass straight through.
        flushAll();
        engaged = false;
        opts.write(data);
        return;
      }
      if (engaged) {
        hold(data);
        return;
      }
      frame.push(data);
      frameChars += data.length;
      if (frameChars > maxHeldChars) {
        failOpen();
        return;
      }
      clearFrameTimer();
      frameTimer = setTimeout(onFrameComplete, frameGapMs);
    },
    sync() {
      if (opts.getSignatures()) return;
      flushAll();
      engaged = false;
      broken = false;
    },
    dispose() {
      clearFrameTimer();
    },
  };
}
