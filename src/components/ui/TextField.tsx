import { useId, type ReactNode, type Ref } from "react";

export function TextField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
  rightAddon,
  type = "text",
  autoFocus,
  inputRef,
  ariaDescribedBy,
  ariaInvalid,
}: {
  id?: string;
  label?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  rightAddon?: ReactNode;
  type?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const describedBy = [ariaDescribedBy, hintId].filter(Boolean).join(" ") || undefined;

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
          alignItems: "center",
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          overflow: "hidden",
        }}
      >
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          ref={inputRef}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid || undefined}
          style={{
            flex: 1,
            background: "transparent",
            border: 0,
            outline: 0,
            color: "var(--text)",
            padding: "9px 12px",
            fontFamily: mono ? "var(--mono)" : "var(--sans)",
            fontSize: 13,
          }}
        />
        {rightAddon && (
          <div
            style={{
              padding: "0 10px",
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 11,
            }}
          >
            {rightAddon}
          </div>
        )}
      </div>
      {hint && (
        <div id={hintId} style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-faint)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
