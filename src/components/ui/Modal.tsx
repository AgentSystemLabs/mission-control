import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { CardFrame } from "./CardFrame";
import { useHotkey } from "~/lib/use-hotkey";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 480,
  height,
  maxWidth = "92vw",
  maxHeight = "85vh",
  footer,
  placement = "center",
  zIndex = 9999,
  contentStyle,
  footerStyle,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number | string;
  height?: number | string;
  maxWidth?: number | string;
  maxHeight?: number | string;
  footer?: ReactNode;
  placement?: "center" | "top";
  zIndex?: number;
  contentStyle?: CSSProperties;
  footerStyle?: CSSProperties;
}) {
  useHotkey(
    "escape",
    (e) => {
      e.stopPropagation();
      onClose();
    },
    { enabled: open, preventDefault: false },
  );

  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const setPanelRef = (node: HTMLElement | null) => {
    panelRef.current = node;
  };
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

  const panelStyle: CSSProperties = {
    width,
    height,
    outline: "none",
    maxWidth,
    maxHeight,
    boxShadow:
      "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const content = (
    <div
      style={{
        background: "var(--surface-1)",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
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
          id={titleId}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
            minWidth: 0,
            flex: 1,
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
      <div style={{ padding: 18, overflowY: "auto", flex: 1, ...contentStyle }}>{children}</div>
      {footer && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            ...footerStyle,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );

  const panelProps = {
    tabIndex: -1,
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": titleId,
    onClick: (e: MouseEvent<HTMLElement>) => e.stopPropagation(),
  };

  const modal = (
    <div
      data-modal-open
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: placement === "top" ? "flex-start" : "center",
        justifyContent: "center",
        paddingTop: placement === "top" ? "12vh" : 0,
        boxSizing: "border-box",
        animation: "fade-up 0.12s ease-out",
      }}
    >
      <CardFrame
        as="section"
        ref={setPanelRef}
        {...panelProps}
        style={panelStyle}
      >
        {content}
      </CardFrame>
    </div>
  );

  if (typeof document === "undefined") return modal;

  return createPortal(modal, document.body);
}
