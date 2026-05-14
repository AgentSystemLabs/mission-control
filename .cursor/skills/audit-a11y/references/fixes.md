# Auto-fix recipes

For each gap: detection pattern → fix-class → exact transform.

---

## Icon-only button missing accessible name

**Detect:** `<button>` (or shadcn `<Button>`) whose only children are an icon component (`<X />`, `<ChevronDown />`, lucide imports, etc.) with no text node and no `aria-label`/`aria-labelledby`/`title`.

**Fix-class:** auto.

**Transform:** add `aria-label="<verb + object>"` derived from the handler or surrounding context (e.g. `onClick={onClose}` → `aria-label="Close"`; `onClick={() => remove(item.id)}` → `aria-label="Remove item"`). If you can't infer a name confidently, mark structural.

```tsx
// before
<Button onClick={onClose}><X /></Button>
// after
<Button onClick={onClose} aria-label="Close"><X /></Button>
```

---

## `<img>` missing `alt`

**Detect:** `<img src=...>` with no `alt` attribute.

**Fix-class:** auto.

**Transform:**
- If the image is decorative (background, illustration next to text that already conveys the info): `alt=""`.
- If meaningful: derive alt from filename / nearby caption / `src` slug. If unclear, default to `alt=""` and add a finding "needs review: confirm decorative vs. content".

Same rule applies to Next.js `<Image>` and other framework wrappers.

---

## `<div onClick>` (or `<span onClick>`) acting as a button

**Detect:** non-interactive element with `onClick`, no `role`, no `tabIndex`.

**Fix-class:** auto.

**Transform:** convert to `<button type="button">`. Preserve `className`, children, and handlers. Strip any redundant `role="button"`, `tabIndex={0}`, manual `onKeyDown` for Enter/Space.

```tsx
// before
<div className="card" onClick={open}>...</div>
// after
<button type="button" className="card" onClick={open}>...</button>
```

If the element is inside an `<a>` or another `<button>`, mark structural — nesting interactives needs design input.

---

## Form input without label association

**Detect:** `<input>`/`<textarea>`/`<select>` with no `id` referenced by a `<label htmlFor>`, no wrapping `<label>`, and no `aria-label`/`aria-labelledby`.

**Fix-class:** auto if there's a visible label-like text node nearby; structural otherwise.

**Transform:** add an `id` to the input and `htmlFor` to the matching `<label>`. Generate an id from the field name (`id="email"`, `id="user-bio"`).

For shadcn `<FormField>`/`<FormLabel>`/`<FormControl>` patterns, the association is usually already wired — only flag if `<FormLabel>` is absent.

---

## Custom interactive component missing role/aria

**Detect:** components named `Menu`, `Dropdown`, `Combobox`, `Tabs`, `Accordion`, `Tooltip`, `Switch`, `Slider`, etc., implemented from scratch (not Radix/shadcn) without WAI-ARIA roles and state attributes.

**Fix-class:** structural. Report — recommend swapping to the project's Radix-based primitive instead of hand-rolling ARIA.

---

## Dynamic region missing `aria-live`

**Detect:** elements that render async status text (toast targets, inline form errors, "Saving…", search-result counts) without `aria-live` or a live-region wrapper.

**Fix-class:** auto for the obvious cases (status text, error messages → `aria-live="polite"`; critical errors → `aria-live="assertive"`).

```tsx
<p className="text-destructive" aria-live="polite">{error}</p>
```

For toast systems, check if the toast root already has a live region (sonner / shadcn `<Toaster>` does); if so, no change.

---

## Modal/Dialog without focus trap

**Detect:** components named `Modal`, `Dialog`, `Sheet`, `Drawer`, `Popover` (when modal) implemented without a focus-trap library and not built on Radix.

**Fix-class:** structural. Report and recommend the project's Radix `Dialog` primitive.

`autoFocus` on the first input is NOT a fix — see SKILL.md NEVER list.

---

## Focus not returned on close

**Detect:** dialogs/menus that close via a callback but don't restore focus to the trigger.

**Fix-class:** structural unless the project uses Radix (which handles this). Report.

---

## Contrast below WCAG AA

**Detect:** Tailwind class pairs like `text-X` on `bg-Y`, inline `color`/`background-color` styles, or CSS-variable token pairs.

**Resolution steps:**
1. Find the project's theme source — typically `tailwind.config.{ts,js}`, `app/globals.css`, or `src/styles/*.css` defining `--foreground`, `--muted-foreground`, etc.
2. Resolve each token to a comparable color value (account for both light and dark mode if both are defined — check both):
   - **Hex (`#1a1a1a`)** — use directly.
   - **`rgb(...)` / `rgba(...)`** — use channel values directly.
   - **`hsl(h s% l%)`** — convert to sRGB via standard HSL→RGB; lightness alone is not luminance.
   - **`oklch(l c h)`** (shadcn default since 2024) — convert oklch → linear sRGB → sRGB. If you can't compute the conversion confidently, fall back to: report the token pair, the raw oklch values, and recommend the user verify in a browser devtools contrast checker — do NOT guess a ratio. Approximating oklch L as sRGB luminance is wrong and will produce false negatives on saturated colors.
   - **CSS variable referencing another variable** — resolve transitively; if the chain leaves the theme file (e.g. references a runtime-computed value), flag as "dynamic — needs visual review".
3. Compute WCAG contrast ratio: `(L1 + 0.05) / (L2 + 0.05)` where `L` is relative luminance computed from sRGB per WCAG 2.x.
4. Thresholds:
   - Body text (< 18pt regular, < 14pt bold): **≥ 4.5:1**
   - Large text (≥ 18pt regular, ≥ 14pt bold): **≥ 3:1**
   - UI components & graphical objects: **≥ 3:1**

**Fix-class:** structural. Report the failing pair, the actual ratio, the threshold, and suggest a darker/lighter existing token (e.g. `text-muted-foreground` → `text-foreground/80`). Never silently change the token's value.

Common offenders to check first:
- `text-muted-foreground` on `bg-muted` (often borderline)
- `text-gray-400`/`text-gray-500` on white
- Placeholder text (`placeholder:text-muted-foreground`)
- Disabled-state text
- Text over images/gradients (no static ratio possible — flag for visual review)

---

## Tab order mismatch

**Detect:** explicit `tabIndex` values > 0, or absolute/fixed positioning that visually reorders interactive elements away from DOM order.

**Fix-class:** structural for visual reordering (needs DOM restructure). Auto for `tabIndex` > 0 → remove it (rely on natural order) **only if** you can confirm by reading the surrounding component that natural order matches visual order; otherwise structural.
