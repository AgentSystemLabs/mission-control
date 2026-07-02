import { useEffect, useRef } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import type { Annotation } from "~/lib/markdown-annotations";
import { MARKDOWN_REFINE_NOTE_MAX_LEN } from "~/shared/markdown-refine";

export function AnnotationsPanel({
  annotations,
  activeId,
  autoFocusId,
  onAutoFocused,
  refining,
  canRefine,
  modelLabel,
  onSelect,
  onChangeNote,
  onRemove,
  onBlurEmpty,
  onRefine,
}: {
  annotations: Annotation[];
  activeId: string | null;
  autoFocusId: string | null;
  onAutoFocused: () => void;
  refining: boolean;
  canRefine: boolean;
  modelLabel: string;
  onSelect: (id: string) => void;
  onChangeNote: (id: string, note: string) => void;
  onRemove: (id: string) => void;
  onBlurEmpty: (id: string) => void;
  onRefine: () => void;
}) {
  return (
    <aside
      aria-label="Comments"
      style={{
        width: 300,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderLeft: "1px solid var(--border)",
        background: "var(--surface-1)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            flex: 1,
            fontFamily: "var(--sans)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          Comments
          <span style={{ color: "var(--text-faint)", fontWeight: 500 }}> · {annotations.length}</span>
        </span>
        <Btn
          variant="primary"
          size="sm"
          icon="sparkles"
          onClick={onRefine}
          disabled={!canRefine}
          title={
            canRefine
              ? `Rewrite and save the file from your comments using ${modelLabel}`
              : "Add at least one comment to refine"
          }
        >
          {refining ? "Refining…" : "Refine"}
        </Btn>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {annotations.map((annotation) => (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            active={annotation.id === activeId}
            autoFocus={annotation.id === autoFocusId}
            disabled={refining}
            onAutoFocused={onAutoFocused}
            onSelect={() => onSelect(annotation.id)}
            onChangeNote={(note) => onChangeNote(annotation.id, note)}
            onRemove={() => onRemove(annotation.id)}
            onBlurEmpty={() => onBlurEmpty(annotation.id)}
          />
        ))}
      </div>

      <footer
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--text-faint)",
          lineHeight: 1.5,
        }}
      >
        Refine rewrites the file with {modelLabel} and saves it to disk. You can close this panel
        while it runs.
      </footer>
    </aside>
  );
}

function AnnotationCard({
  annotation,
  active,
  autoFocus,
  disabled,
  onAutoFocused,
  onSelect,
  onChangeNote,
  onRemove,
  onBlurEmpty,
}: {
  annotation: Annotation;
  active: boolean;
  autoFocus: boolean;
  disabled: boolean;
  onAutoFocused: () => void;
  onSelect: () => void;
  onChangeNote: (note: string) => void;
  onRemove: () => void;
  onBlurEmpty: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
    onAutoFocused();
  }, [autoFocus, onAutoFocused]);

  const range =
    annotation.anchor.lineEnd > annotation.anchor.lineStart
      ? `Lines ${annotation.anchor.lineStart}–${annotation.anchor.lineEnd}`
      : `Line ${annotation.anchor.lineStart}`;

  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "9px 10px",
        borderRadius: 8,
        border: `1px solid ${active ? "var(--accent-border)" : "var(--border)"}`,
        background: active ? "var(--accent-dim)" : "var(--surface-0)",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            flex: 1,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--accent)",
          }}
        >
          {range}
        </span>
        <button
          type="button"
          aria-label={`Delete comment for ${range}`}
          title={`Delete comment for ${range}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          disabled={disabled}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            padding: 0,
            border: "1px solid var(--border)",
            borderRadius: 5,
            background: "var(--surface-1)",
            color: "var(--text-dim)",
            cursor: disabled ? "not-allowed" : "pointer",
            flexShrink: 0,
          }}
        >
          <Icon name="trash" size={11} />
        </button>
      </div>

      {annotation.anchor.quote && (
        <blockquote
          title={annotation.anchor.quote}
          style={{
            margin: 0,
            paddingLeft: 8,
            borderLeft: "2px solid var(--border-strong)",
            fontFamily: "var(--sans)",
            fontSize: 11.5,
            lineHeight: 1.45,
            color: "var(--text-dim)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {annotation.anchor.quote}
        </blockquote>
      )}

      <textarea
        ref={textareaRef}
        value={annotation.note}
        disabled={disabled}
        aria-label={`Comment for ${range}`}
        maxLength={MARKDOWN_REFINE_NOTE_MAX_LEN}
        placeholder="Describe the change you want here…"
        rows={2}
        onFocus={onSelect}
        onChange={(event) => onChangeNote(event.target.value)}
        onBlur={() => {
          if (!annotation.note.trim()) onBlurEmpty();
        }}
        style={{
          width: "100%",
          resize: "vertical",
          minHeight: 44,
          padding: "6px 8px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface-1)",
          color: "var(--text)",
          fontFamily: "var(--sans)",
          fontSize: 12.5,
          lineHeight: 1.5,
          outline: "none",
        }}
      />
    </div>
  );
}
