---
name: audit-responsive
description: Static responsive-design audit of a route or component — finds layouts that will break at common viewports (mobile 375, tablet 768, desktop 1280, ultrawide 1920). Detects: fixed widths in pixels for layout containers, horizontal overflow risk (long words, fixed tables, wide fixed grids), missing `flex-wrap`, missing responsive Tailwind variants on grid/flex containers, hardcoded `vh` heights that break with mobile keyboards, font sizes that don't scale, sidebars/navigation with no collapse strategy, modals taller than mobile viewports, images without `max-width: 100%`. Auto-fixes mechanical issues inline (add `flex-wrap`, swap `w-[400px]` for `w-full md:w-[400px]`, add `max-w-full` to images); reports structural ones (a 5-column desktop grid that fundamentally needs a different mobile layout). Trigger phrases — "audit responsive", "check mobile layout", "responsive issues", "/audit-responsive", "does this work on mobile", "tablet view check", "is this layout responsive". Skip for — desktop-only apps explicitly scoped to large viewports (Electron desktop tools, video editing UIs), pure backend, copy edits.
---

# Audit Responsive

Static analysis only — the skill reads files, doesn't open a browser. Findings are about constructs known to break at narrow viewports; the user verifies in a real browser after applying fixes.

---

## Phase 1 — Scope

Default scope = a route or component the user names. The skill follows imports one layer deep (the route file plus its directly-imported feature components, not the whole UI library).

Identify the project's CSS strategy:

- **Tailwind** (most common in this stack) → look for `w-`, `h-`, `flex`, `grid`, breakpoint prefixes (`sm:`, `md:`, `lg:`).
- **CSS Modules / vanilla CSS** → look for media queries.
- **CSS-in-JS** (styled-components, emotion) → look for `@media` strings inside template literals.

**Exit:** files in scope identified; CSS strategy known.

---

## Phase 2 — Pattern Sweep

Scan for the failure-mode catalog. Each match becomes a finding with file:line, the construct, the failing viewport, and the fix.

### Fixed pixel widths on layout containers

```tsx
<div className="w-[480px] ...">          // fixed → breaks below 480px
<div className="grid-cols-4 ...">        // fixed grid → breaks below ~640px
```

Layout containers (the elements *deciding* width — main, sidebar, page wrappers) should be fluid by default. `w-full md:w-[480px]` is fine; bare `w-[480px]` is not.

### Missing `flex-wrap`

```tsx
<div className="flex gap-4">             // children don't wrap → horizontal overflow on mobile
```

Any `flex` row that contains > 1 child whose combined width might exceed the viewport needs `flex-wrap` (or a deliberate horizontal scroll container).

### Hardcoded `100vh` heights

```css
height: 100vh;
```

On mobile browsers, `100vh` includes the URL bar; the actual visible height is smaller and the layout is cut off when the bar appears. Use `100dvh` (dynamic viewport height) or `min-h-screen` with internal scrolling.

### No mobile-first responsive prefix on grid/flex columns

```tsx
<div className="grid grid-cols-3 gap-4">        // 3 cols at every viewport, including 320px
```

Tailwind convention is mobile-first. The default classes apply to mobile; breakpoint prefixes (`sm:`, `md:`, `lg:`) widen at larger sizes. `grid-cols-1 md:grid-cols-3` is correct; `grid-cols-3` alone is a mobile bug.

### Tables with no horizontal scroll wrapper

```tsx
<table className="w-full">
```

Tables that have > 3 columns or any column with long content (URLs, ids, free text) overflow on mobile. Wrap in `<div className="overflow-x-auto">` so the table scrolls horizontally instead of breaking the page layout.

### Long unbreakable words

```tsx
<span>{user.id}</span>                          // long ids, URLs, emails break out of containers
```

For fields that may contain long unbreakable strings (UUIDs, URLs, emails), use `break-all` or `break-words` (Tailwind: `break-words`).

### Fixed-width images

```tsx
<img src="..." />                               // intrinsic width can exceed mobile viewport
```

Images need `max-w-full h-auto` (or equivalent) so they scale down on narrow viewports.

### Sidebar/nav with no mobile strategy

```tsx
<aside className="w-64 fixed left-0 top-0 h-screen ...">
```

If a sidebar is `fixed w-64`, on mobile it overlays content with no toggle. The skill flags this and points out that a `Sheet` / `Drawer` / hamburger toggle is the project's likely answer.

### Fonts that don't scale

```tsx
<h1 className="text-6xl ...">                   // 60px+ headings on mobile = wrap/overflow
```

Large headings need responsive variants: `text-3xl md:text-5xl lg:text-6xl`.

### Modal/dialog with fixed dimensions taller than mobile

```tsx
<Dialog className="h-[600px] w-[800px]">
```

Modals must scroll internally when content exceeds the viewport, or use `max-h-[90vh] overflow-auto`.

### Min-widths that exceed mobile

```css
min-width: 480px;                               // forces horizontal scroll on iPhone SE (375px)
```

`min-width` on layout containers is almost always a mistake at the page level. Allowed for inputs/buttons within a wrapped container.

**Exit:** raw findings list compiled.

---

## Phase 3 — Triage

Mark each finding **MECHANICAL** (apply inline) or **STRUCTURAL** (report; needs design):

- **MECHANICAL:** add `flex-wrap`, add `max-w-full h-auto` to images, swap `100vh` → `100dvh`, add `break-words` to long-id spans, wrap tables in `overflow-x-auto`.
- **STRUCTURAL:** a 5-column grid that fundamentally needs a different mobile layout; a sidebar that needs a Sheet replacement on mobile; a 60px heading that needs different weight + size scale; a modal whose content needs splitting into multiple screens on mobile.

**Exit:** every finding is labeled.

---

## Phase 4 — Apply Mechanical Fixes

Apply each MECHANICAL fix inline. After each file's edits, run the project's typecheck/lint quickly to make sure no new errors slipped in (Tailwind class changes shouldn't break compile, but the project may have a className linter).

**Exit:** all MECHANICAL findings are fixed in the code.

---

## Phase 5 — Report

```
Responsive Audit — <scope>
──────────────────────────

Fixed inline (MECHANICAL)
  src/components/Header.tsx:14   added flex-wrap on nav row
  src/routes/posts.tsx:88        100vh → 100dvh on main scroll container
  src/components/Avatar.tsx:9    image got max-w-full h-auto

Needs design (STRUCTURAL)
  src/routes/dashboard.tsx:42   5-column grid with fixed grid-cols-5
                                 → propose: cards stack on <md, 2-col on md, 5-col on xl
  src/components/Sidebar.tsx:8  fixed w-64 sidebar with no mobile toggle
                                 → propose: replace with Sheet for <md viewports

Verify in browser
  - 375  (mobile)
  - 768  (tablet)
  - 1280 (desktop)
  - 1920 (ultrawide if relevant)
```

Tell the user the next step is to actually open the page at those viewports — static analysis is necessary but not sufficient.

---

## NEVER

- **NEVER apply structural responsive changes inline.**
  **Instead:** report; let the user (or a designer) decide on the mobile layout.
  **Why:** a 5-column grid on desktop becoming a stacked single column on mobile is a design choice — does it become 2-col on tablet first? Which column collapses last? Auto-fixing produces something that compiles but looks wrong, and the wrongness is harder to spot than an obvious bug.

- **NEVER replace `100vh` with `100dvh` everywhere blindly.**
  **Instead:** check the surrounding usage. `dvh` is right for full-height scroll containers; for pinned elements (sticky footer, modal) the right answer may be `min-h-svh` (small viewport height) or a JS measurement.
  **Why:** the three viewport units (`vh`, `dvh`, `svh`, `lvh`) each behave differently with mobile browser chrome. The wrong substitute can cause flickering or layout jumps that are worse than the original bug.

- **NEVER assume Tailwind's default breakpoints match the project's design system.**
  **Instead:** read `tailwind.config.*` for custom breakpoint definitions before suggesting `md:`/`lg:` variants.
  **Why:** projects often customize breakpoints (smaller `md`, larger `lg`). Suggesting default breakpoint classes can land at the wrong viewport.

- **NEVER add a horizontal-scroll table wrapper without checking whether the project already has a `<DataTable>` component.**
  **Instead:** find and use the existing primitive.
  **Why:** ad hoc `overflow-x-auto` divs fragment the design system. The `<DataTable>` likely already handles header sticking, focus, and accessible scroll regions — reinventing them inline is regression bait.

- **NEVER report "may not be responsive" without a specific viewport.**
  **Instead:** every finding cites the viewport at which the construct breaks (e.g., "below 768px the 4-col grid produces a 25%-width column that's narrower than the minimum readable").
  **Why:** "may not be responsive" is the audit version of "be careful". A specific breakage threshold gives the user a verification path.

- **NEVER skip the browser-verification reminder.**
  **Instead:** every report ends with the four canonical viewports to test.
  **Why:** static analysis catches the constructs known to break; the actual breakage depends on content (long words, image dimensions, dynamic data). Without the in-browser pass, "audit clean" doesn't mean "looks right".
