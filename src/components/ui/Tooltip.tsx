import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useBinding } from "~/lib/keybindings/store";
import type { Binding, HotkeyAction } from "~/lib/keybindings/types";
import { Kbd, KbdCombo } from "./Kbd";

const SHOW_DELAY_MS = 350;
const GAP_PX = 6;

type Placement = "top" | "bottom";

type TooltipProps = {
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  disabled?: boolean;
};

type Coords = { top: number; left: number; placement: Placement };

export function Tooltip({
  content,
  children,
  placement = "top",
  disabled = false,
}: TooltipProps) {
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);

  const cancelShow = useCallback(() => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }, []);

  const scheduleShow = useCallback(() => {
    cancelShow();
    showTimer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  }, [cancelShow]);

  const close = useCallback(() => {
    cancelShow();
    setOpen(false);
    setCoords(null);
  }, [cancelShow]);

  useEffect(() => () => cancelShow(), [cancelShow]);

  useLayoutEffect(() => {
    if (!open) return;
    const wrapper = wrapperRef.current;
    const tooltip = tooltipRef.current;
    if (!wrapper || !tooltip) return;

    // Wrapper uses display:contents and has no box of its own — measure the actual trigger child.
    const triggerEl = (wrapper.firstElementChild as HTMLElement | null) ?? wrapper;
    const triggerRect = triggerEl.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let resolvedPlacement: Placement = placement;
    let top =
      placement === "top"
        ? triggerRect.top - tooltipRect.height - GAP_PX
        : triggerRect.bottom + GAP_PX;

    if (placement === "top" && top < 8) {
      resolvedPlacement = "bottom";
      top = triggerRect.bottom + GAP_PX;
    } else if (
      placement === "bottom" &&
      top + tooltipRect.height > window.innerHeight - 8
    ) {
      resolvedPlacement = "top";
      top = triggerRect.top - tooltipRect.height - GAP_PX;
    }

    let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const minLeft = 8;
    const maxLeft = window.innerWidth - tooltipRect.width - 8;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;

    setCoords({ top, left, placement: resolvedPlacement });
  }, [open, placement, content]);

  if (disabled || content == null || content === false) {
    return <>{children}</>;
  }

  // Pass aria-describedby to the child so screen readers connect button → tooltip.
  const child = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": open ? id : undefined,
      } as Record<string, unknown>)
    : children;

  return (
    <>
      <span
        ref={wrapperRef}
        className="mc-tooltip-trigger"
        onMouseOver={(e: ReactMouseEvent<HTMLSpanElement>) => {
          // Only schedule when pointer enters from outside the wrapper subtree.
          if (!wrapperRef.current?.contains(e.relatedTarget as Node | null)) {
            scheduleShow();
          }
        }}
        onMouseOut={(e: ReactMouseEvent<HTMLSpanElement>) => {
          if (!wrapperRef.current?.contains(e.relatedTarget as Node | null)) {
            close();
          }
        }}
        onFocus={(e) => {
          // Only open for focus on the wrapped trigger itself, not deeper descendants
          // (composite triggers may contain other focusables).
          if (e.target === wrapperRef.current?.firstElementChild) {
            cancelShow();
            setOpen(true);
          }
        }}
        onBlur={(e) => {
          if (e.target === wrapperRef.current?.firstElementChild) {
            close();
          }
        }}
      >
        {child}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tooltipRef}
            id={id}
            role="tooltip"
            className="mc-tooltip"
            data-placement={coords?.placement ?? placement}
            style={{
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              visibility: coords ? "visible" : "hidden",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}

/** Tooltip that displays the user's current binding for a hotkey action. */
export function HotkeyTooltip({
  action,
  label,
  children,
  placement = "top",
  disabled = false,
}: {
  action: HotkeyAction;
  label?: ReactNode;
  children: ReactElement;
  placement?: Placement;
  disabled?: boolean;
}) {
  const binding = useBinding(action);
  return (
    <Tooltip
      placement={placement}
      disabled={disabled}
      content={
        <span className="mc-tooltip-row">
          {label != null && <span className="mc-tooltip-label">{label}</span>}
          <KbdCombo binding={binding} variant="inline" />
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}

/** Tooltip for buttons that dismiss via Escape. */
export function EscTooltip({
  label,
  children,
  placement = "top",
  disabled = false,
}: {
  label?: ReactNode;
  children: ReactElement;
  placement?: Placement;
  disabled?: boolean;
}) {
  return (
    <StaticHotkeyTooltip hotkey="Esc" label={label} placement={placement} disabled={disabled}>
      {children}
    </StaticHotkeyTooltip>
  );
}

/** Tooltip with a static Kbd label (e.g. Esc) for non-action hotkeys. */
export function StaticHotkeyTooltip({
  hotkey,
  binding,
  parts,
  label,
  children,
  placement = "top",
  disabled = false,
}: {
  hotkey?: ReactNode;
  binding?: Binding;
  parts?: string[];
  label?: ReactNode;
  children: ReactElement;
  placement?: Placement;
  disabled?: boolean;
}) {
  const kbd =
    binding != null ? (
      <KbdCombo binding={binding} variant="inline" />
    ) : parts != null && parts.length > 0 ? (
      <KbdCombo parts={parts} variant="inline" />
    ) : (
      <Kbd variant="inline">{hotkey}</Kbd>
    );

  return (
    <Tooltip
      placement={placement}
      disabled={disabled}
      content={
        <span className="mc-tooltip-row">
          {label != null && <span className="mc-tooltip-label">{label}</span>}
          {kbd}
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}
