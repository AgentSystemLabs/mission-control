import { useId, useState } from "react";
import { Icon } from "~/components/ui/Icon";

export function SettingsSection({
  title,
  subtitle,
  headingLevel = "h2",
  children,
}: {
  title: string;
  subtitle?: string;
  headingLevel?: "h1" | "h2";
  children: React.ReactNode;
}) {
  const Heading = headingLevel;

  return (
    <section
      style={{
        marginBottom: 24,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <Heading
          style={{
            fontFamily: "var(--mono)",
            fontSize: headingLevel === "h1" ? 22 : 11,
            fontWeight: 600,
            letterSpacing: headingLevel === "h1" ? 0 : "0.08em",
            textTransform: headingLevel === "h1" ? "none" : "uppercase",
            color: "var(--text)",
            margin: "0 0 4px",
          }}
        >
          {title}
        </Heading>
        {subtitle && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--text-dim)",
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--text-dim)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export function CodeBlock({
  value,
  onCopy,
  copied,
  monoSize = 12,
}: {
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  monoSize?: number;
}) {
  return (
    <div
      style={{
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "10px 12px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <pre
        style={{
          margin: 0,
          fontFamily: "var(--mono)",
          fontSize: monoSize,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          flex: 1,
        }}
      >
        {value}
      </pre>
      {onCopy && (
        <button
          onClick={onCopy}
          style={{
            background: copied ? "var(--accent-dim)" : "transparent",
            border: "1px solid var(--border)",
            color: copied ? "var(--accent)" : "var(--text-dim)",
            padding: "4px 8px",
            borderRadius: 5,
            cursor: "pointer",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={11} />
          {copied ? "copied" : "copy"}
        </button>
      )}
    </div>
  );
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return { copied, copy };
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  labelledBy?: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="settings-toggle-switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden className="settings-toggle-switch__knob" />
    </button>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  label,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const labelId = useId();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 14px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div>
        <div
          id={titleId}
          style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}
        >
          {title}
        </div>
        <div
          id={descriptionId}
          style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}
        >
          {description}
        </div>
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
        <span id={labelId} className="sr-only">
          {label}
        </span>
        <ToggleSwitch
          checked={checked}
          disabled={disabled}
          label={label}
          labelledBy={`${titleId} ${labelId}`}
          describedBy={descriptionId}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
