---
name: audit-a11y
description: Static accessibility audit of a route/component — checks keyboard reachability, screen-reader semantics (ARIA labels, label/input association, roles), and WCAG AA color contrast. Auto-fixes the mechanical gaps inline (icon-button labels, image alt, label htmlFor, div-as-button → button, missing role/aria-*); reports structural ones (focus traps, tab-order rewrites, contrast token swaps that need design input). Pure file reads + grep, no axe-core or browser. Trigger phrases — "a11y audit", "accessibility audit", "screen reader check", "keyboard accessibility", "WCAG", "aria check", "/audit-a11y", "is this accessible", "audit this page for a11y", "tab order", "contrast check". Skip for — pure backend/server changes, copy-only edits, CSS tokens-only changes with no UI affected, and audits requiring real browser/axe-core (recommend Playwright + axe instead).
---

# audit-a11y

Static a11y audit for one route/component. Four phases — do them in order.

## Phase 1 — Scope

Identify the audit surface from the user's target (a route file, component, or "this page"):

1. Read the target file.
2. Walk imports of project-local components (ignore `node_modules`, design-system primitives like shadcn `ui/*` unless the user names them).
3. Count files in the resulting set. Audit all of them unless the surface is large enough that the resulting report would be unactionable in one pass — in that case, audit the target + its direct children + any shared interactive primitive (Modal, Dialog, Form wrappers) it uses. Report the skipped surface explicitly so the user can ask for a follow-up pass.

State the scope as a short list before scanning. If the user already named a narrow scope ("just this component"), skip the walk.

## Phase 2 — Scan

For each in-scope file, look for the gaps below. **Read [`references/fixes.md`](references/fixes.md) now** — it has the exact detection pattern and code transform for each one. Do NOT load `references/fixes.md` in Phase 1 or Phase 4 (it's only needed during scan + fix; it adds noise during scoping and reporting).

Categories to scan:

- **Keyboard reachability** — `<div onClick>`, `role="button"` without `tabIndex`/key handlers, `tabIndex="-1"` on interactive elements, custom dropdowns/menus without arrow-key handling.
- **Screen-reader semantics** — icon-only buttons with no accessible name, `<img>` with no `alt`, form inputs with no associated `<label htmlFor>` / `aria-labelledby` / `aria-label`, custom interactive components missing `role` and `aria-*`, dynamic regions (toasts, status text) missing `aria-live`.
- **Focus management** — modals/dialogs/sheets/drawers without focus trap, focus not returned to trigger on close, autofocus missing on primary input.
- **Contrast** — text color + background pairs below WCAG AA (4.5:1 body, 3:1 large text & UI). Resolve Tailwind/shadcn tokens to hex by reading the project's CSS variables / theme config; compute ratio. Common offenders: `text-muted-foreground` on `bg-muted`, gray-on-gray, low-opacity overlays.

Build a finding list: `{file:line, category, severity, fix-class}` where `fix-class ∈ {auto, structural}`.

## Phase 3 — Auto-fix

Before applying any fix, ask: **Does this change visible behavior?** If yes, mark the finding structural and report it instead — auto-fix is reserved for mechanically-deterministic edits.

Apply every `fix-class: auto` finding inline using the recipes in `references/fixes.md`. Group edits by file.

Before each edit, verify:
- The fix doesn't change visible behavior (e.g. don't add `aria-label="Close"` if a visible "Close" text already exists — use that).
- For `<div onClick>` → `<button>` conversions, preserve existing classNames; add `type="button"` to avoid form-submit surprises.
- For label association, prefer `htmlFor`/`id` over wrapping when the input is already standalone.

After fixing, re-read each touched file once to confirm the edits stack cleanly (multiple findings in one file can interact).

## Phase 4 — Report

Output:

Use these section labels:

- `## A11y audit — <target>` with a `Scope:` line
- `### Auto-fixed` — one bullet per fix, each with `file:line`
- `### Needs your call` — structural findings with `file:line`, the gap, and a suggested direction
- `### Contrast` — failing token/hex pairs with the actual ratio, the WCAG threshold, and a suggested swap or "needs design input"

If there are zero findings, say so plainly — don't pad.

## NEVER

- **NEVER add `aria-label` to an element that already has a visible accessible name**
  **Instead:** Use the visible text as the name; only label icon-only or visually-empty controls.
  **Why:** Duplicate labels cause screen readers to announce the name twice, and a mismatched `aria-label` silently overrides the visible text — failing WCAG 2.5.3 (Label in Name) and breaking voice control.

- **NEVER convert `<div onClick>` to `<button>` without also setting `type="button"`**
  **Instead:** Always add `type="button"` unless the element is genuinely a form submit.
  **Why:** Inside a `<form>`, `<button>` defaults to `type="submit"` and will submit the form on click — a behavior change the user will only catch at runtime.

- **NEVER auto-"fix" contrast by changing a design token's value**
  **Instead:** Report the failing pair and suggest a different existing token, or flag for design input.
  **Why:** Token values are a global design decision; changing `--muted-foreground` to satisfy one component shifts every other surface that uses it.

- **NEVER add `role="button"` as a fix**
  **Instead:** Use a real `<button>`. `role="button"` requires manually wiring `Enter`/`Space` handlers, focus styles, and `disabled` semantics — a real button gets all of that for free.
  **Why:** Hand-rolled `role="button"` ships broken keyboard support 90% of the time; the platform element is always the right answer.

- **NEVER mark decorative images with descriptive `alt` text**
  **Instead:** Use `alt=""` (empty, not missing) for purely decorative images.
  **Why:** Missing `alt` makes screen readers announce the file path; descriptive alt on decoration adds noise. Empty `alt` is the explicit "skip this" signal.

- **NEVER claim a focus trap is "fixed" by adding `autoFocus`**
  **Instead:** Report focus-trap gaps as structural — they need a real trap (e.g. project's existing `Dialog` primitive, `focus-trap-react`, or shadcn's Radix-based components).
  **Why:** `autoFocus` puts the cursor in the modal but does nothing to keep it there; `Tab` will still escape into the page behind. Half-fixes are worse than reports because they hide the problem.
