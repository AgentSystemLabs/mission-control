import { useId, type Ref } from "react";

export function Textarea({
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
  rows = 5,
  autoFocus,
  textareaRef,
  disabled,
}: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  rows?: number;
  autoFocus?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const inputId = `mc-textarea-${generatedId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            fontWeight: 500,
            color: "var(--text-dim)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          display: "flex",
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          overflow: "hidden",
        }}
      >
        <textarea
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          autoFocus={autoFocus}
          ref={textareaRef}
          disabled={disabled}
          aria-describedby={hintId}
          style={{
            flex: 1,
            resize: "vertical",
            background: "transparent",
            border: 0,
            outline: 0,
            color: "var(--text)",
            padding: "9px 12px",
            fontFamily: mono ? "var(--mono)" : "var(--sans)",
            fontSize: 13,
            lineHeight: 1.5,
            minHeight: rows * 18,
          }}
        />
      </div>
      {hint && (
        <div
          id={hintId}
          style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
