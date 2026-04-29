import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useHotkey } from "~/lib/use-hotkey";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 480,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  useHotkey(
    "escape",
    (e) => {
      e.stopPropagation();
      onClose();
    },
    { enabled: open, preventDefault: false },
  );

  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div
      data-modal-open
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "fade-up 0.12s ease-out",
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          outline: "none",
          maxWidth: "92vw",
          maxHeight: "85vh",
          background: "var(--surface-1)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 18px",
              borderTop: "1px solid var(--border)",
              background: "var(--surface-0)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
