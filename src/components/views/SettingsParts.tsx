import { useState } from "react";
import { Icon } from "~/components/ui/Icon";

export function SettingsSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 24,
        padding: 20,
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 12,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text)",
            marginBottom: 4,
          }}
        >
          {title}
        </div>
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
    </div>
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
