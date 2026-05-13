# A11y Audit Report — Whole-Renderer Pass

Static audit of `src/components/**` and `src/routes/**` (2026-05-12). Mechanical fixes applied inline; structural items captured below.

## Mechanical fixes applied

| File | Fix |
| --- | --- |
| `src/components/views/GroupsDialog.tsx` | Added `aria-label="Cancel rename"` to icon-only cancel button. |
| `src/components/views/GroupsDialog.tsx` | Added `aria-label="Rename group {name}"` to icon-only rename button. |
| `src/components/views/GroupsDialog.tsx` | Added `aria-label="Remove group {name}"` to icon-only trash button. |
| `src/components/views/LaunchCommandsDialog.tsx` | Added `aria-label="Remove launch command"` to icon-only trash button. |

Total: **4 mechanical fixes** applied.

`pnpm typecheck` is green after the changes.

## What was checked and is clean

- `<img>` alt text — `ProjectIcon`, `__root.tsx` doors, and `TopBar` all have explicit `alt` (decorative `""` or descriptive). No new alt-text gaps.
- Modal focus trap — `src/components/ui/Modal.tsx` already implements a tab-cycle focus trap (lines 59-83) and restores focus on close. All dialogs route through `Modal`, so trap coverage is uniform.
- Form error messaging — `LicenseEntryModal`, `LaunchKitDialog`, `InstallSkillsModal`, `SkillsSettingsPage`, `Banner`, `TaskCard` all use `role="alert"` for transient error surfaces. `Tooltip` wires `aria-describedby` correctly.
- Implicit `<label>` association — `LicenseEntryModal`, `NewAgentDialog`, `InstallSkillsModal` all wrap their `<input>` inside the `<label>` element (implicit association is valid HTML; no `htmlFor` needed).
- `Btn` (`src/components/ui/Btn.tsx`) passes `aria-label`, `title`, etc. through `...rest` to the underlying `<button>` — consumers are responsible for naming icon-only Btn usages (spot-checked: all current call sites either pass children text or `title`).
- `ProjectBar` icon-only project buttons already have `aria-label={tooltip}` (line 95).
- `Modal` close, `Banner` dismiss, `OpenProjectButton`, and `ProjectCard` overlay button all have `aria-label`.

## Structural items (report-only — need design / multi-file refactor)

### S1 — `TextField` label is not programmatically associated with its `<input>` (`src/components/ui/TextField.tsx`)
The wrapper renders `<label>` as a sibling of `<input>` with no `htmlFor` / `id` pairing. Clicking the label doesn't focus the input, and screen readers won't announce the label when the input is focused. The fix is a `useId()` + `htmlFor={id}` + `id={id}` pair — attempted during this pass but the file is in flight from another agent (revert observed). Re-apply once the TextField owner lands their changes.

### S2 — Free-standing `<label>` siblings in dialogs
- `src/components/views/LaunchKitDialog.tsx:104-117` — "Working directory" label not bound to the inner `TextField` input.
- `src/components/views/ProjectDialog.tsx:190, 215, 266, 320` — same pattern (file excluded from this pass; in flight).
- `src/components/views/GeneralSettingsPage.tsx:156-173, 345-365` — `useId()` already used in one case (good); the older `<label>` at 156 only wraps a `<input type="checkbox">` and is OK by implicit association.

Once S1 lands (TextField gains `htmlFor`), S2's `LaunchKitDialog` case still needs a manual edit — its label is a sibling of `TextField`, not its prop. Recommend either passing `label="Working directory"` to `TextField` or adding `htmlFor` + `id` manually around the inner `<input>`.

### S3 — `<span onClick=...>` acting as button in `GroupsDialog`
`src/components/views/GroupsDialog.tsx:141-152` renders the group name as a `<span>` with `onClick` to start renaming. Not keyboard-reachable, no role. Recommend converting to `<button type="button">` styled flat, or removing the click affordance entirely now that an explicit rename button is adjacent.

### S4 — `<button>` in `GroupsDialog` rename row uses raw `<input>` instead of `TextField`
`src/components/views/GroupsDialog.tsx:86-111` — raw input with no label at all (rename context comes from surrounding row). Add `aria-label={`Rename group ${g.name}`}` to the input, or replace with `TextField` once S1 lands.

### S5 — `<div role="menu">` context menu in `ProjectBar` lacks roving tabindex
`src/components/views/ProjectBar.tsx:183-232` — single menuitem today (Unpin), so no tab-order problem yet. If the menu grows to 2+ items, add roving tabindex + ArrowUp/ArrowDown handlers. Note for future maintenance.

### S6 — `:focus-visible` styles
Project uses inline styles, not Tailwind. No global `:focus-visible` rule found in `src/styles.css` for custom interactive elements (buttons fall back to the browser default outline). Two paths forward:
1. Add a global `*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` rule in `src/styles.css` (low risk — many inline styles set `outline: 0` on inputs explicitly, but buttons don't).
2. Audit each `outline: 0` / `outline: "none"` site and replace with a `:focus-visible` carve-out.
Recommend (1) as the mechanical default plus a follow-up sweep to remove redundant `outline: 0` declarations.

Inputs that explicitly set `outline: 0` and would silently swallow the default focus ring under either approach:
- `src/components/ui/TextField.tsx:63`
- `src/components/views/LaunchCommandsDialog.tsx:172, 156`
- `src/components/views/LicenseEntryModal.tsx:207`
- `src/components/views/GroupsDialog.tsx:105`

These need an explicit `:focus-visible` border/box-shadow swap.

### S7 — Color contrast (design input needed)
Spot-checks against the dark theme tokens — most pairings are fine (`var(--text)` on `var(--surface-0)` ≈ 14:1). Likely-low-contrast pairings flagged for design review:
- `var(--text-faint)` on `var(--surface-0)` — used widely for badges, counts, hotkey hints (`ProjectBar.tsx:168`, `GroupsDialog.tsx:175`, `LaunchCommandsDialog.tsx:135`). Estimated ~3.5:1 — passes WCAG AA for "large text" only. Confirm with token contrast measurement and bump the faint token if it must serve as small-text body.
- `var(--text-dim)` on accent-tinted backgrounds (settings nav, banner variants) — borderline; needs measurement.
- Status-failed red on `var(--surface-0)` (`role="alert"` blocks) — visually salient; should be verified at 4.5:1 for AA small text.

Recommend a one-time Figma / Stark sweep of the design tokens rather than per-component fixes.

## Files explicitly skipped (in flight from other agents)

Per task constraints — findings noted above but no edits applied:
`projects.$id.tsx`, `terminal-store.tsx`, `user-terminal-store.tsx`, `GitDiffView/*`, `TopBar.tsx`, `HeaderActionsSlot.tsx`, `ShimmerBar.tsx`, `ProjectDialog.tsx`, `__root.tsx`, `TerminalPane.tsx`, `UserTerminalPane.tsx`, `TaskCard.tsx`.

Additionally, `src/components/ui/TextField.tsx` appears to be in flight (edit was reverted mid-pass). Re-attempt S1 once the working tree settles.

## Counts

- **4** mechanical fixes applied (all icon-button accessible names).
- **7** structural items reported (S1–S7).
