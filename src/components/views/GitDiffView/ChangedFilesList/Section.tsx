import type { ReactNode } from "react";
import { Icon } from "~/components/ui/Icon";
import { SECTION_TONES, textBtnStyle } from "./constants";

export function Section({
  label,
  count,
  tone,
  children,
  actionIcon,
  actionTitle,
  onAction,
  actionDisabled,
  extra,
}: {
  label: string;
  count: number;
  tone: "staged" | "unstaged";
  children: React.ReactNode;
  actionIcon?: "plus" | "x";
  actionTitle?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  extra?: ReactNode;
}) {
  const sectionTone = SECTION_TONES[tone];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          borderBottom: `1px solid ${sectionTone.border}`,
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: sectionTone.text,
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <span
          style={{
            color: sectionTone.count,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
        <span style={{ flex: 1 }}>{label}</span>
        {onAction && actionIcon && actionTitle && (
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled}
            title={actionTitle}
            aria-label={actionTitle}
            style={{
              ...textBtnStyle,
              opacity: actionDisabled ? 0.5 : 1,
              cursor: actionDisabled ? "not-allowed" : "pointer",
            }}
          >
            <Icon name={actionIcon} size={10} />
            <span>{actionTitle}</span>
          </button>
        )}
        {extra}
      </div>
      {children}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--text-faint)",
      }}
    >
      {text}
    </div>
  );
}
