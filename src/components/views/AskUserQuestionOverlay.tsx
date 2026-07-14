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
  // Peek: collapse the panel to its header so the terminal (Claude's actual
  // question + the context above it) is readable without giving up the menu.
  const [collapsed, setCollapsed] = useState(false);
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
    // Tab peeks: collapse to the header so the terminal shows through, and a
    // second Tab (or any answer key below) brings the menu back.
    if (e.key === "Tab") {
      e.preventDefault();
      if (!(submitting || finished || desynced)) setCollapsed((c) => !c);
      return;
    }
    if (submitting || finished || desynced) return;
    if (collapsed) {
      // While peeking, the first actionable key re-opens the menu.
      if (
        e.key === "Enter" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        (e.key >= "1" && e.key <= "9")
      ) {
        e.preventDefault();
        setCollapsed(false);
      }
      return;
    }
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
          gap: 10,
          padding: "8px 10px",
          background: highlighted ? "var(--surface-2)" : "transparent",
          border: "none",
          // Full inset ring on the active row — never a side stripe.
          boxShadow: highlighted
            ? "inset 0 0 0 1px var(--border-strong)"
            : "inset 0 0 0 1px transparent",
          borderRadius: "var(--radius-sm)",
          cursor: submitting ? "default" : "pointer",
          textAlign: "left",
          transition: "background 130ms ease, box-shadow 130ms ease",
        }}
      >
        {props.glyph}
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            style={{
              fontSize: 13,
              lineHeight: 1.4,
              fontWeight: 450,
              color: props.dim ? "var(--text-dim)" : "var(--text)",
            }}
          >
            {props.label}
          </span>
          {!narrow && props.description && (
            <span
              style={{
                fontSize: 11.5,
                lineHeight: 1.45,
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
  // Only truly collapse while the menu is interactive — a resolved/sending
  // state must stay visible so its message isn't hidden behind the header.
  const peeking = collapsed && !passive;

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
      className="mc-aq-panel"
      style={{
        position: "absolute",
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        maxHeight: "min(75%, 360px)",
        background: "var(--surface-1)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius)",
        boxShadow:
          "0 12px 32px -8px rgba(0, 0, 0, 0.55), 0 4px 12px -6px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
        outline: "none",
        overflow: "hidden",
        animation: "fade-up 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div
        onClick={peeking ? () => setCollapsed(false) : undefined}
        title={peeking ? "Show the answer menu" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 10px 9px 12px",
          // Peeking drops the divider so the bar reads as a floating strip.
          borderBottom: peeking ? "1px solid transparent" : "1px solid var(--border)",
          // Faint state wash: this pane needs input, and the header says so.
          background: "color-mix(in srgb, var(--status-needs) 6%, transparent)",
          flexShrink: 0,
          cursor: peeking ? "pointer" : "default",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "var(--status-needs)",
            boxShadow: "0 0 0 3px color-mix(in srgb, var(--status-needs) 20%, transparent)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.01em",
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {question.header || "Question"}
        </span>
        {total > 1 && (
          <span
            style={{
              flexShrink: 0,
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--text-dim)",
              padding: "1px 6px",
              borderRadius: 999,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          >
            {questionIdx + 1}/{total}
          </span>
        )}
        <span style={{ marginLeft: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {peeking && !narrow && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-faint)" }}>
              terminal visible
            </span>
          )}
          {!narrow && !peeking && <Kbd>esc</Kbd>}
          {!passive && (
            <Btn
              variant="ghost"
              size="sm"
              icon={collapsed ? "chevron-up" : "chevron-down"}
              aria-label={collapsed ? "Show the answer menu" : "Collapse to see the terminal"}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => !c);
              }}
            />
          )}
          <Btn
            variant="ghost"
            size="sm"
            icon="x"
            aria-label="Hide question"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
          />
        </span>
      </div>

      {!peeking && (passive ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px",
            fontSize: 12.5,
            lineHeight: 1.4,
            color: "var(--text-dim)",
          }}
        >
          {submitting && (
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                border: "1.5px solid var(--border-strong)",
                borderTopColor: "var(--accent)",
                animation: "spin 0.7s linear infinite",
                flexShrink: 0,
              }}
            />
          )}
          {finished ?? (submitting ? "Sending answers…" : "Answering in the terminal…")}
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "12px 12px 8px",
              fontSize: 13.5,
              lineHeight: 1.5,
              fontWeight: 450,
              color: "var(--text)",
              flexShrink: 0,
            }}
          >
            {question.question}
          </div>
          {textMode ? (
            <div style={{ padding: "2px 12px 12px" }}>
              <input
                ref={textInputRef}
                className="mc-aq-input"
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="Type your answer…"
                aria-label="Custom answer"
                style={{
                  width: "100%",
                  padding: "9px 11px",
                  background: "var(--surface-0, var(--bg))",
                  // The input is auto-focused whenever it's visible, so it wears
                  // the focused ring outright rather than only on :focus.
                  border: "1px solid var(--accent-border)",
                  borderRadius: "var(--radius-sm)",
                  outline: "none",
                  boxShadow: "0 0 0 3px var(--accent-faint)",
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  color: "var(--text)",
                }}
              />
            </div>
          ) : (
            <div style={{ overflowY: "auto", padding: "0 6px 6px", minHeight: 0 }}>
              {question.options.map((option, i) =>
                optionRow({
                  index: i,
                  glyph: multiSelect
                    ? checkGlyph(checked.has(i), i === highlightIdx)
                    : digitChip(i + 1, i === highlightIdx),
                  label: option.label,
                  description: option.description,
                  onClick: () => activate(i),
                }),
              )}
              {!multiSelect && (
                <>
                  <div
                    aria-hidden
                    style={{ borderTop: "1px solid var(--border)", margin: "6px 8px" }}
                  />
                  {optionRow({
                    index: typeRowIdx,
                    glyph: digitChip(typeRowIdx + 1, typeRowIdx === highlightIdx),
                    label: "Type something…",
                    dim: true,
                    onClick: () => activate(typeRowIdx),
                  })}
                  {optionRow({
                    index: chatRowIdx,
                    glyph: digitChip(chatRowIdx + 1, chatRowIdx === highlightIdx),
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
              padding: "8px 12px",
              borderTop: "1px solid var(--border)",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
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
                        {hint("peek", ["⇥"])}
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
      ))}
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

const glyphBase: CSSProperties = {
  flexShrink: 0,
  width: 19,
  height: 19,
  marginTop: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--mono)",
  lineHeight: 1,
  borderRadius: 5,
  transition: "color 130ms ease, background 130ms ease, border-color 130ms ease",
};

/**
 * The leading number doubles as the row's "you are here" marker and its
 * numeric shortcut — it lights up in accent on the highlighted row.
 */
function digitChip(label: ReactNode, highlighted: boolean): ReactNode {
  return (
    <span
      aria-hidden
      style={{
        ...glyphBase,
        fontSize: 10.5,
        fontWeight: highlighted ? 600 : 500,
        color: highlighted ? "var(--accent-ink)" : "var(--text-faint)",
        border: `1px solid ${highlighted ? "var(--accent-border)" : "var(--border)"}`,
        background: highlighted ? "var(--accent-faint)" : "var(--surface-0)",
      }}
    >
      {label}
    </span>
  );
}

function checkGlyph(selected: boolean, highlighted: boolean): ReactNode {
  return (
    <span
      aria-hidden
      style={{
        ...glyphBase,
        fontSize: 11,
        fontWeight: 600,
        color: selected ? "var(--accent-ink)" : "transparent",
        border: `1px solid ${
          selected
            ? "var(--accent-border)"
            : highlighted
              ? "var(--border-strong)"
              : "var(--border)"
        }`,
        background: selected ? "var(--accent-faint)" : "var(--surface-0)",
      }}
    >
      {selected ? "✓" : ""}
    </span>
  );
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
