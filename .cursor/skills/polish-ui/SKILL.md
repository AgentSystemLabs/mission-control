---
name: polish-ui
description: Run a UX polish checklist against any UI change in this project — new components, new buttons/modals, or edits to existing UI — and auto-fix gaps before reporting done. The skill judges which items apply to the specific change, then fixes them inline (not as a follow-up). Trigger phrases and scenarios — adding/editing a button, dialog, modal, popover, sheet, drawer, command palette, form submit, confirmation prompt, keyboard-driven action; "add a button", "build this modal", "wire up this dialog", "new form", any UI/UX work in .tsx/.jsx files. Skip for: pure backend, copy-only edits with no interaction change, type-only refactors.
---

# UX Checklist

You just changed UI. Before reporting done, walk this checklist, decide which items apply to **this specific change**, and fix gaps inline.

The list is designed to grow. Treat every item as load-bearing — each one exists because the user had to re-prompt for it.

---

## Checklist

> **Growth contract:** When appending an item, give it three things — (1) the rule, (2) when it applies, (3) the fix. Items missing any of the three get skipped during evaluation.

### 1. Action buttons display their keyboard shortcut

If a button triggers an action that has (or should have) a keyboard shortcut, the shortcut must appear **in the visible button text**, not just as a `title`/`aria-keyshortcuts`.

**Convention:** mac glyphs, trailing the label, separated by a space.

- `Save ⌘S`
- `Submit ⌘↵`
- `Cancel ⎋`
- `Delete ⌫`

Glyph reference: `⌘` cmd · `⌥` opt · `⇧` shift · `⌃` ctrl · `↵` enter · `⎋` esc · `⌫` delete · `→ ← ↑ ↓` arrows.

**Applies when:** the button is a primary/secondary action with a clear shortcut (Save, Submit, Confirm, Cancel, Delete, Search, New). A button qualifies when its label is a verb and it triggers a single discrete action. Skip for icon-only buttons in toolbars where the label is already a tooltip, and for buttons inside a list row where per-row shortcuts don't make sense.

**Fix:** add the glyph to the label AND wire the actual key handler (the visible shortcut must work — a label without a binding is a lie).

**Conflicts:** if two visible actions on the same view want the same shortcut, the more frequent action wins; the other gets a modifier (`⇧⌘S`) or no shortcut.

### 2. Modals close on Esc

Any modal/dialog/sheet/drawer/popover that traps attention must close on `Esc`.

**Fix:** if using a primitive (Radix Dialog, shadcn Dialog, HeadlessUI, etc.), Esc-to-close is usually built in — verify it isn't disabled (`onEscapeKeyDown` preventing default, `closeOnEscape={false}`). If hand-rolled, add a `keydown` listener on `Escape` that calls the close handler, scoped to the modal's lifetime.

Also verify: focus returns to the trigger element after close. If the modal hijacks focus and never returns it, that's a bug even if Esc works.

---

## How to use this skill

For each item, decide if it applies to this change; if yes, fix in the same edit pass and report one line per fix. Skip silent items — no "N/A" padding.

---

## NEVER

- **NEVER add a shortcut glyph to a label without binding the key handler**
  **Instead:** Wire the `keydown` listener (or framework equivalent) in the same edit. If you can't bind it, don't show it.
  **Why:** A visible `⌘S` that does nothing is worse than no hint — users press it, nothing happens, trust drops.

- **NEVER report a UI change as done while skipping this checklist**
  **Instead:** Run the filter step before your final message. Even a one-line button change qualifies.
  **Why:** The checklist exists because the user had to re-prompt. Skipping it reproduces the exact failure mode the skill was created to prevent.

- **NEVER list checklist gaps as "follow-up work"**
  **Instead:** Fix them in the same turn. If a gap is genuinely out of scope (e.g., requires a new dependency), surface it explicitly and ask — don't silently defer.
  **Why:** Deferred UX polish never gets done; it accumulates as the same re-prompt the user is trying to eliminate.

- **NEVER render mac glyphs without detecting platform** (when the app ships to non-mac users)
  **Instead:** Detect platform once (`navigator.platform`, `userAgent`, or a `usePlatform()` hook if the project has one) and swap to `Ctrl+S` / `Alt` / `Esc` text on Windows/Linux. If the project is mac-only, state that here and skip the swap.
  **Why:** `⌘` and `⌥` render as unfamiliar symbols (or boxes in missing fonts) on Windows/Linux, turning a hint into noise. The bind still works; the *label* lies about which key to press.

- **NEVER force items that don't apply**
  **Instead:** Skip an item when the change has no surface for it (e.g., a backend-only tweak that touched a `.tsx` import). Padding with "N/A" wastes the user's attention.
  **Why:** Mechanical compliance erodes trust in the checklist's signal — every reported item should be a real fix.
