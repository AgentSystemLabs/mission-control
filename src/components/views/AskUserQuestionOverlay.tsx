import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Btn } from "~/components/ui/Btn";
import { Kbd } from "~/components/ui/Kbd";
import type { AgentQuestion, PendingQuestion } from "~/shared/agent-questions";
import { sanitizeFreeText, type QuestionAnswer } from "~/lib/agent-question-answer";

/** Inline keyboard hint: rendered key glyphs followed by a label. */
function hint(label: string, keys: string[]): ReactNode {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      {label}
    </span>
  );
}

/**
 * Native choice UI for a Claude Code AskUserQuestion menu, anchored to the
 * bottom of the session's terminal pane.
 *
 * Answers are collected locally — advancing to the next question is instant,
 * and ←/→ steps back and forth to revise earlier answers — while the TUI menu
 * underneath stays parked on question 1. Only the final submit injects
 * keystrokes into the PTY, walking every question in one verified sequence
 * (see buildPayloadAnswerKeySequence).
 *
 * Mirrors the TUI's synthetic rows: "Type something…" (inline free-text
 * answer) and "Chat about this" (cancels the question, agent continues
 * conversationally). Both are single-select-only, matching the row layout the
 * key injection navigates.
 */
export function AskUserQuestionOverlay({
  pending,
  desynced,
  narrow,
  terminalOwnedFocus,
  onSubmitAnswers,
  onDismiss,
  onFocusTerminal,
  restoreTerminalFocus,
}: {
  pending: PendingQuestion;
  /** User typed in the terminal — injected keys would target the wrong row. */
  desynced: boolean;
  /** Tiny grid cell: drop option descriptions to keep rows scannable. */
  narrow: boolean;
  /** Whether this pane's terminal held focus (safe to take it, never steal across panes). */
  terminalOwnedFocus: () => boolean;
  /**
   * Inject the collected answers (one per question, or ending early with a
   * chat answer) into the TUI. Resolves false when nothing could be sent.
   */
  onSubmitAnswers: (answers: QuestionAnswer[]) => Promise<boolean>;
  onDismiss: () => void;
  onFocusTerminal: () => void;
  /** Give focus back to the terminal when the overlay unmounts while holding it. */
  restoreTerminalFocus: () => void;
}) {
  const [questionIdx, setQuestionIdx] = useState(0);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [textMode, setTextMode] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [answers, setAnswers] = useState<(QuestionAnswer | null)[]>(() =>
    pending.questions.map(() => null),
  );
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const question = pending.questions[questionIdx];
  const total = pending.questions.length;
  const optionCount = question?.options.length ?? 0;
  const multiSelect = question?.multiSelect ?? false;
  // Single-select lists mirror the TUI's trailing synthetic rows.
  const typeRowIdx = multiSelect ? -1 : optionCount;
  const chatRowIdx = multiSelect ? -1 : optionCount + 1;
  const rowCount = multiSelect ? optionCount : optionCount + 2;

  // Take keyboard focus only when the terminal underneath owned it — the menu
  // it was driving is now fronted by this overlay. Never yank focus from
  // another pane or dialog.
  useEffect(() => {
    if (terminalOwnedFocus()) containerRef.current?.focus();
  }, [questionIdx]);

  useEffect(() => {
    if (textMode) textInputRef.current?.focus();
  }, [textMode]);

  // Keep the keyboard-highlighted row visible when the list scrolls.
  useEffect(() => {
    rowRefs.current[highlightIdx]?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, questionIdx]);

  // If the overlay disappears (question answered/cleared) while it holds
  // focus, hand focus back to the terminal instead of dropping it on <body>.
  // Focus-within is tracked via capture handlers because blur may never fire
  // when a focused node is removed from the DOM.
  const hasFocusRef = useRef(false);
  const restoreFocusRef = useRef(restoreTerminalFocus);
  restoreFocusRef.current = restoreTerminalFocus;
  useEffect(() => {
    return () => {
      if (hasFocusRef.current) restoreFocusRef.current();
    };
  }, []);

  if (!question) return null;

  /**
   * When focus sits on a child about to unmount (the free-text input, a row
   * button), move it to the container BEFORE the re-render removes the node —
   * Chromium silently drops focus from removed elements onto <body> without
   * firing blur, which would strand the keyboard until the user clicks back.
   */
  const keepOverlayFocus = () => {
    const active = document.activeElement;
    if (active && active !== containerRef.current && containerRef.current?.contains(active)) {
      containerRef.current.focus();
    }
  };

  /** Move to `idx`, restoring whatever was recorded for it. */
  const goTo = (idx: number, record: (QuestionAnswer | null)[]) => {
    const target = pending.questions[idx];
    if (!target) return;
    keepOverlayFocus();
    const recorded = record[idx] ?? null;
    setQuestionIdx(idx);
    setChecked(
      recorded?.kind === "options" && recorded.multiSelect
        ? new Set(recorded.optionIndexes)
        : new Set(),
    );
    setTextDraft(recorded?.kind === "freeText" ? recorded.text : "");
    setTextMode(false);
    setHighlightIdx(restoredHighlight(target, recorded));
  };

  const submitAll = (record: QuestionAnswer[]) => {
    if (submitting || finished || desynced) return;
    // Submitting swaps in the passive view; park focus on the container first
    // so it survives (and the unmount handoff returns it to the terminal).
    keepOverlayFocus();
    setSubmitting(true);
    setFailed(false);
    void onSubmitAnswers(record)
      .then((ok) => {
        if (!ok) {
          setFailed(true);
          return;
        }
        setFinished(
          record[record.length - 1]?.kind === "chat"
            ? "Continuing in chat…"
            : "Answer sent — waiting for the agent…",
        );
      })
      .finally(() => setSubmitting(false));
  };

  /** Record this question's answer, then advance — or submit after the last. */
  const recordAnswer = (answer: QuestionAnswer) => {
    if (submitting || finished || desynced) return;
    if (answer.kind === "options" && answer.optionIndexes.length === 0) return;
    if (answer.kind === "freeText" && !sanitizeFreeText(answer.text)) return;
    const next = answers.slice();
    next[questionIdx] = answer;
    setAnswers(next);
    if (answer.kind === "chat") {
      // Chat cancels the whole tool; earlier answers only steer the TUI here.
      submitAll([...next.slice(0, questionIdx), answer] as QuestionAnswer[]);
      return;
    }
    if (questionIdx + 1 < total) {
      goTo(questionIdx + 1, next);
    } else {
      submitAll(next as QuestionAnswer[]);
    }
  };

  const goBack = () => {
    if (questionIdx === 0 || submitting || !!finished) return;
    goTo(questionIdx - 1, answers);
  };

  // Forward only through questions that were already answered.
  const goForward = () => {
    if (submitting || !!finished) return;
    if (!answers[questionIdx] || questionIdx + 1 >= total) return;
    goTo(questionIdx + 1, answers);
  };

  const toggleChecked = (index: number) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const activate = (index: number) => {
    setHighlightIdx(index);
    if (multiSelect) {
      toggleChecked(index);
      return;
    }
    if (index === typeRowIdx) {
      setTextMode(true);
      return;
    }
    if (index === chatRowIdx) {
      recordAnswer({ kind: "chat" });
      return;
    }
    recordAnswer({ kind: "options", optionIndexes: [index], multiSelect: false });
  };

  const submitFreeText = () => {
    recordAnswer({ kind: "freeText", text: textDraft });
  };

  const submitMultiSelect = () => {
    recordAnswer({
      kind: "options",
      optionIndexes: checked.size > 0 ? [...checked] : [highlightIdx],
      multiSelect: true,
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (textMode) {
        setTextMode(false);
        containerRef.current?.focus();
      } else {
        onDismiss();
      }
      return;
    }
    if (submitting || finished || desynced) return;
    if (textMode) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitFreeText();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((h) => (h + 1) % rowCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((h) => (h - 1 + rowCount) % rowCount);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goBack();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goForward();
    } else if (e.key >= "1" && e.key <= String(Math.min(rowCount, 9))) {
      e.preventDefault();
      activate(Number(e.key) - 1);
    } else if (e.key === " " && multiSelect) {
      e.preventDefault();
      toggleChecked(highlightIdx);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (multiSelect) {
        submitMultiSelect();
      } else {
        activate(highlightIdx);
      }
    }
  };

  const optionRow = (props: {
    index: number;
    glyph: ReactNode;
    label: ReactNode;
    description?: string;
    dim?: boolean;
    onClick: () => void;
  }) => {
    const highlighted = props.index === highlightIdx;
    return (
      <button
        key={props.index}
        type="button"
        ref={(el) => {
          rowRefs.current[props.index] = el;
        }}
        onClick={props.onClick}
        onMouseMove={() => setHighlightIdx(props.index)}
        disabled={submitting}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          padding: "6px 8px",
          background: highlighted ? "var(--surface-2)" : "transparent",
          border: "none",
          borderLeft: `2px solid ${highlighted ? "var(--accent)" : "transparent"}`,
          borderRadius: "var(--radius-sm)",
          cursor: submitting ? "default" : "pointer",
          textAlign: "left",
        }}
      >
        {props.glyph}
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              color: props.dim ? "var(--text-dim)" : "var(--text)",
            }}
          >
            {props.label}
          </span>
          {!narrow && props.description && (
            <span
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                color: "var(--text-dim)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {props.description}
            </span>
          )}
        </span>
      </button>
    );
  };

  const passive = desynced || !!finished || submitting;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-label={question.header || "Agent question"}
      onKeyDown={onKeyDown}
      onFocusCapture={() => {
        hasFocusRef.current = true;
      }}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null;
        hasFocusRef.current = !!next && !!containerRef.current?.contains(next);
      }}
      data-question-overlay
      style={{
        position: "absolute",
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        maxHeight: "min(75%, 340px)",
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.4)",
        outline: "none",
        overflow: "hidden",
        animation: "fade-up 0.12s ease-out",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--text-dim)",
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "var(--status-needs)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: "var(--text)",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {question.header || "Question"}
        </span>
        {total > 1 && (
          <span style={{ flexShrink: 0 }}>
            {questionIdx + 1}/{total}
          </span>
        )}
        <span style={{ marginLeft: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {!narrow && <Kbd>esc</Kbd>}
          <Btn variant="ghost" size="sm" icon="x" aria-label="Hide question" onClick={onDismiss} />
        </span>
      </div>

      {passive ? (
        <div
          style={{
            padding: "10px 12px",
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--text-dim)",
          }}
        >
          {finished ?? (submitting ? "Sending answers…" : "Answering in the terminal…")}
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "9px 12px 7px",
              fontSize: 12.5,
              lineHeight: 1.45,
              color: "var(--text)",
              flexShrink: 0,
            }}
          >
            {question.question}
          </div>
          {textMode ? (
            <div style={{ padding: "2px 12px 10px" }}>
              <input
                ref={textInputRef}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="Type your answer…"
                aria-label="Custom answer"
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  background: "var(--surface-0, var(--bg))",
                  border: "1px solid var(--border-strong, var(--border))",
                  borderRadius: "var(--radius-sm)",
                  outline: "none",
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--text)",
                }}
              />
            </div>
          ) : (
            <div style={{ overflowY: "auto", padding: "0 6px 6px", minHeight: 0 }}>
              {question.options.map((option, i) =>
                optionRow({
                  index: i,
                  glyph: multiSelect ? (
                    <span aria-hidden style={checkboxStyle(checked.has(i))}>
                      {checked.has(i) ? "✓" : ""}
                    </span>
                  ) : (
                    <span aria-hidden style={digitStyle}>
                      {i + 1}
                    </span>
                  ),
                  label: option.label,
                  description: option.description,
                  onClick: () => activate(i),
                }),
              )}
              {!multiSelect && (
                <>
                  <div
                    aria-hidden
                    style={{ borderTop: "1px solid var(--border)", margin: "4px 8px" }}
                  />
                  {optionRow({
                    index: typeRowIdx,
                    glyph: (
                      <span aria-hidden style={digitStyle}>
                        {typeRowIdx + 1}
                      </span>
                    ),
                    label: "Type something…",
                    dim: true,
                    onClick: () => activate(typeRowIdx),
                  })}
                  {optionRow({
                    index: chatRowIdx,
                    glyph: (
                      <span aria-hidden style={digitStyle}>
                        {chatRowIdx + 1}
                      </span>
                    ),
                    label: "Chat about this",
                    dim: true,
                    onClick: () => activate(chatRowIdx),
                  })}
                </>
              )}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "6px 10px",
              borderTop: "1px solid var(--border)",
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--text-faint)",
              flexShrink: 0,
            }}
          >
            {failed ? (
              <span style={{ color: "var(--status-needs)" }}>
                Could not send — answer in the terminal.
              </span>
            ) : textMode ? (
              <>
                {hint("send", ["↵"])}
                {!narrow && hint("back to options", ["esc"])}
              </>
            ) : (
              <>
                {questionIdx > 0 && (
                  <button
                    type="button"
                    onClick={goBack}
                    aria-label="Edit the previous question"
                    style={hintButtonStyle}
                  >
                    <Kbd>←</Kbd> previous
                  </button>
                )}
                {narrow
                  ? hint("select", ["↵"])
                  : (
                      <>
                        {hint("navigate", ["↑", "↓"])}
                        {multiSelect && hint("toggle", ["space"])}
                        {hint(multiSelect ? "submit" : "select", ["↵"])}
                      </>
                    )}
              </>
            )}
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
              {multiSelect && !narrow && (
                <button type="button" onClick={onFocusTerminal} style={linkStyle}>
                  Type a custom answer
                </button>
              )}
              {textMode && (
                <Btn
                  variant="accent"
                  size="sm"
                  disabled={submitting || !sanitizeFreeText(textDraft)}
                  onClick={submitFreeText}
                >
                  {questionIdx + 1 < total ? "Next" : "Send"}
                </Btn>
              )}
              {multiSelect && (
                <Btn
                  variant="accent"
                  size="sm"
                  disabled={submitting || checked.size === 0}
                  onClick={submitMultiSelect}
                >
                  {questionIdx + 1 < total ? "Next" : "Submit"}
                </Btn>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Highlight to restore when navigating back to an answered question. */
function restoredHighlight(
  question: AgentQuestion,
  recorded: QuestionAnswer | null,
): number {
  if (recorded?.kind === "options") return recorded.optionIndexes[0] ?? 0;
  if (recorded?.kind === "freeText") {
    return question.multiSelect ? 0 : question.options.length; // the Type-something row
  }
  if (recorded?.kind === "chat") {
    return question.multiSelect ? 0 : question.options.length + 1;
  }
  return 0;
}

const digitStyle: CSSProperties = {
  flexShrink: 0,
  width: 16,
  height: 16,
  marginTop: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--mono)",
  fontSize: 10,
  color: "var(--text-faint)",
  border: "1px solid var(--border)",
  borderRadius: 4,
};

function checkboxStyle(selected: boolean): CSSProperties {
  return {
    ...digitStyle,
    color: selected ? "var(--accent-ink)" : "transparent",
    borderColor: selected ? "var(--accent-border)" : "var(--border)",
    background: selected ? "var(--accent-faint)" : "transparent",
  };
}

const linkStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontFamily: "var(--mono)",
  fontSize: 10,
  color: "var(--text-dim)",
  textDecoration: "underline",
  textUnderlineOffset: 2,
  cursor: "pointer",
};

const hintButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  border: "none",
  padding: 0,
  fontFamily: "inherit",
  fontSize: "inherit",
  color: "inherit",
  cursor: "pointer",
};
