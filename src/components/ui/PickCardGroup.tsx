import { useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "~/components/ui/Icon";

export type PickCardOption<V extends string> = {
  value: V;
  /** Accessible name; include the disabled reason so AT hears why. */
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  /** Card contents (leading glyph + label). The group renders the selected
      checkmark itself so every picker confirms in the same grammar. */
  content: (selected: boolean) => ReactNode;
};

/**
 * Radiogroup of pick-cards (agent, layout, …) implementing the ARIA radio
 * pattern the visuals promise: one tab stop, arrow keys move between options.
 * Arrows land on `aria-disabled` options too — they stay discoverable and
 * announce their reason — but only enabled options take the selection.
 */
export function PickCardGroup<V extends string>({
  ariaLabel,
  value,
  onChange,
  options,
  style,
  deselectable = false,
}: {
  ariaLabel: string;
  value: V | null;
  onChange: (value: V | null) => void;
  options: PickCardOption<V>[];
  style?: CSSProperties;
  /** When set, clicking (or Space on) the selected option clears it back to
      null — the selection becomes optional rather than a locked-in radio. */
  deselectable?: boolean;
}) {
  const refs = useRef(new Map<V, HTMLButtonElement>());
  // While the group holds focus, the tab stop follows the focused option
  // (which may be disabled); at rest it sits on the selection.
  const [focusValue, setFocusValue] = useState<V | null>(null);

  const enabledValues = options.filter((o) => !o.disabled).map((o) => o.value);
  const restingStop =
    options.some((o) => o.value === value && !o.disabled) ? value : enabledValues[0] ?? options[0]?.value;
  const tabStop = focusValue ?? restingStop;

  const moveTo = (index: number) => {
    const target = options[index];
    if (!target) return;
    refs.current.get(target.value)?.focus();
    if (!target.disabled) onChange(target.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const activeIndex = options.findIndex(
      (o) => refs.current.get(o.value) === document.activeElement,
    );
    if (activeIndex < 0) return;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveTo((activeIndex + 1) % options.length);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveTo((activeIndex - 1 + options.length) % options.length);
        break;
      case "Home":
        e.preventDefault();
        moveTo(0);
        break;
      case "End":
        e.preventDefault();
        moveTo(options.length - 1);
        break;
    }
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocusValue(null);
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} style={style} onKeyDown={onKeyDown} onBlur={onBlur}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              if (el) refs.current.set(opt.value, el);
              else refs.current.delete(opt.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.ariaLabel}
            aria-disabled={opt.disabled || undefined}
            tabIndex={opt.value === tabStop ? 0 : -1}
            onFocus={() => setFocusValue(opt.value)}
            onClick={() =>
              !opt.disabled && onChange(deselectable && selected ? null : opt.value)
            }
            className="mc-pick-card"
            data-selected={selected}
            title={opt.title}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 9,
              textAlign: "left",
              padding: "9px 10px",
              // Selected reads three ways: a faint accent wash in the fill (so
              // selection shows in hue, not only tone), the soft --accent-border
              // ring, and the checkmark below. The wash stays dilute so an
              // agent's own brand-colored glyph still owns the card.
              background: selected
                ? "color-mix(in srgb, var(--accent) 9%, var(--surface-2))"
                : "var(--surface-0)",
              border: `1px solid ${selected ? "var(--accent-border)" : "var(--border)"}`,
              borderRadius: 7,
              cursor: opt.disabled ? "not-allowed" : "pointer",
              opacity: opt.disabled ? 0.5 : 1,
            }}
          >
            {opt.content(selected)}
            {selected && (
              <span
                aria-hidden
                style={{ marginLeft: "auto", display: "flex", color: "var(--accent)", flex: "0 0 auto" }}
              >
                <Icon name="check" size={12} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
