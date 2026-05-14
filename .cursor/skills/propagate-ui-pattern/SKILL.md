---
name: propagate-ui-pattern
description: When the user requests a UX-pattern change (keyboard, focus, dismiss, or feedback-display behavior) on a single instance of a recurring component family (Modal, Dialog, Drawer, Form, Card, Toast), grep for sibling instances, present them per-instance, and — when 3+ approved siblings would share the same inline implementation — propose extracting a shared hook/wrapper before applying. Also propagates the visual affordance (kbd hint, aria-keyshortcuts, footer hotkey line) alongside the behavior. Trigger phrases — "add a hotkey to this modal", "Cmd+Enter should submit", "make X close on escape", "autofocus this input", "make sure all my modals do X", "every form should Y", "consolidate this pattern", "dedupe this across components", "show the hotkey hint", "add ⌘↵ badge", "make the shortcut discoverable". Skip for: one-off visual tweaks scoped to a single component, new features (use add-feature), bug fixes (use fix-bug), changes the user has explicitly scoped to one component ("only in this one").
---

# UX Consistency

Single-instance UX changes silently create drift. The user adds Cmd+Enter to one modal; six other modals stay inconsistent until someone notices months later. This skill catches the propagation question *before* the diff lands.

## The flow

1. **Classify the change.** Is it a UX *pattern* (a behavior that users expect to be uniform across similar components) or a one-off (a tweak specific to this component's role)?
2. **Identify the component family.** What's the recurring type — Modal, Dialog, Form, Drawer, Card, Toast, Popover?
3. **Enumerate siblings.** Grep the codebase for other instances of that family.
4. **Present the list with per-instance recommendations.** For each sibling, mark *propagate* / *skip* / *ask* and give a one-line reason.
5. **Get per-instance approval.** Apply only to the ones the user confirms.

Do not skip steps 3–5. The whole point of the skill is the sibling sweep — implementing the requested change without it defeats the purpose.

## Step 1 — Is this a UX pattern?

**Classify before enumerating.** Misclassifying a one-off as a pattern leaks role-specific behavior across the family (e.g. propagating a destructive-modal hotkey to benign modals); misclassifying a pattern as a one-off creates the silent drift this skill exists to prevent.

Patterns to propagate by default:
- Keyboard shortcuts on dismissable surfaces (Escape closes, Cmd/Ctrl+Enter submits)
- Autofocus on the primary input when a modal/dialog opens
- Click-outside-to-close on non-destructive overlays
- Focus return to trigger element on close
- Loading state placement (button vs. overlay)
- Form submit-on-Enter for single-field forms

Likely **one-offs** (don't propagate without asking):
- A hotkey tied to that component's specific action (e.g. "G then I" for a Goto-Item picker)
- Behavior tied to a unique business rule ("require typing the project name to delete")
- Changes the user has already scoped ("just in NewAgentDialog")

If unsure, classify as pattern and let the per-instance gate filter false positives.

## Step 2 — Find the family

Pick the import or component name that defines the family, not the file path. If the project has a shared primitive (`<Modal>`, `<Dialog>` from a UI lib), grep for its consumers. If components are ad-hoc (each file rolls its own dialog div), grep by structural marker — `role="dialog"`, `position: fixed.*z-`, `onKeyDown.*Escape` — since there's no import to anchor on.

**Zero siblings:** If grep returns no other instances, surface "single instance, no propagation needed" before applying — don't proceed silently. The user invoked this skill expecting a sweep; confirming the sweep ran (and was empty) keeps trust.

**Ambiguous family:** If multiple plausible family roots exist (e.g. `<Modal>` + `<Dialog>` + `<Sheet>`, or hand-rolled dialog divs alongside the shared primitive), grep all of them and group results by root. Present the groups and let the user clarify scope before per-instance approval — don't pick a root and silently exclude the others.

## Step 3 — Present, don't auto-apply

Output format:

```
Found N siblings of <Component>. Recommend per-instance:

1. src/components/views/NewAgentDialog.tsx     — APPLY (target of original request)
2. src/components/views/ProjectDialog.tsx      — APPLY (same submit-form pattern, no destructive action)
3. src/components/views/DeleteConfirmModal.tsx — SKIP (destructive; submit-on-Enter is dangerous)
4. src/components/ui/Modal.tsx                 — N/A (the primitive itself, no submit handler)
5. src/components/views/ProjectPicker.tsx      — ASK (unclear: it's a picker, not a form)

Approve which? (e.g. "1,2,5" or "all except 3")
```

Same shape works for non-modal families. Example for `<Form>`:

```
Found 4 <Form> consumers. Recommend per-instance:

1. src/components/views/SignupForm.tsx       — APPLY (single-input email field; Enter to submit fits)
2. src/components/views/CommentForm.tsx      — APPLY (textarea + send; Cmd+Enter is the standard pairing)
3. src/components/views/SearchForm.tsx       — SKIP (Enter already triggers live search; binding submit would double-fire)
4. src/components/views/MultiStepForm.tsx    — ASK (Enter could mean "next step" or "final submit" — clarify with user)
```

Surface the asymmetry reasons explicitly — destructive vs. benign, form vs. picker, owns-its-state vs. controlled. Those are the cases where automatic propagation breaks UX.

## Step 4 — Extract before applying (when 3+ siblings will share the same code)

If the approved list has **3 or more siblings** that would each get the same inline implementation (same `useEffect` keydown handler, same `onKeyDown` block, same focus-trap setup), stop and propose extraction *before* writing any of the per-site changes. Two or fewer → just inline it; the abstraction isn't worth its own seam yet.

**Read all approved sites before designing the seam.** Note each site's ref shape, event source, and any local quirks (debounce, conditional skip, alt keybinding). The hook/wrapper signature must fit the *union* of these needs — not the first site you opened. Skipping this step bakes site-1's quirks into the abstraction and forces every other site into adapter code.

Pick the seam by what the behavior needs:

- **Pure behavior, no markup** (keyboard shortcut, focus return, click-outside) → custom hook: `useSubmitOnCmdEnter(formRef, onSubmit)`, `useEscapeToClose(onClose)`.
- **Behavior + wrapper element** (focus trap, scroll lock) → wrapper component or extend the shared primitive itself.
- **Behavior tied to a specific primitive's lifecycle** (autofocus on Dialog open) → push into the primitive's props (`<Dialog autoFocusFirstInput>`).

Present the proposal in one block:

```
3 sites approved (NewAgentDialog, ProjectDialog, EditTagDialog) — same Cmd+Enter handler each.
Proposed seam: `useSubmitOnCmdEnter(formRef, onSubmit)` in src/hooks/.
Each call site loses ~6 lines; new hook is ~12 lines.
Proceed with extraction, or inline at each site? (e/i)
```

If the user picks extraction, write the hook/wrapper first, then migrate sites one-by-one, then verify the inline duplicates are gone (grep for the keydown literal). If the user picks inline, apply directly.

## Step 5 — Apply (behavior + its visual affordance)

A UX pattern usually has two halves: the **behavior** (the keydown handler, the focus call, the dismiss) and the **affordance** (the `<kbd>⌘↵</kbd>` hint in the button, the autofocus ring, the "Esc to close" footnote). When you propagate the behavior, propagate the affordance too — otherwise siblings have the feature but no one discovers it.

Before writing the diff, check the original site (or the most-polished sibling) for:

- A `<kbd>` / `<Shortcut>` / hotkey-hint element inside the primary button
- An aria-keyshortcuts attribute
- A footer line like "Press Esc to close" or "⌘K to search"
- A focus ring or visual cue tied to the behavior

Replicate whichever exist. If none exist on any site, surface that as a one-line flag at the end ("none of these modals show the hotkey to the user — worth adding?") rather than fixing it unilaterally.

Apply changes (extracted seam + migrated sites, or inline edits) in one batch. For each ASK that the user approved, briefly confirm the variant fits (e.g. some modals may need a different keybinding because Enter already does something).

## NEVER

- **NEVER apply the requested change to siblings without asking**
  **Instead:** Present the list, get per-instance approval, then apply.
  **Why:** Sibling asymmetry is often intentional (destructive modals, role-specific dialogs). Auto-propagating turns a UX win into a regression that's hard to spot in review.

- **NEVER skip the sibling sweep on the assumption "the user only meant this one"**
  **Instead:** Run the grep anyway. If siblings exist, present them. The user can answer "just this one" in two seconds.
  **Why:** The user usually doesn't know how many siblings exist — that's the whole reason this skill is needed. Trusting their initial scope is how drift happens.

- **NEVER include the primitive (`<Modal>`, `<Dialog>` base component) in the apply list**
  **Instead:** Mark it N/A and apply only to consumers — unless the change genuinely belongs in the primitive (e.g. a focus trap that every consumer should inherit).
  **Why:** Pushing consumer-specific behavior into the base component leaks role-specific logic into shared code and forces every other consumer to opt out.

- **NEVER present the sibling list without per-instance reasons**
  **Instead:** Each row gets APPLY/SKIP/ASK plus a one-line reason.
  **Why:** A bare list forces the user to re-derive the asymmetry analysis for every row. The reason column is the value the skill provides.

- **NEVER expand scope to other UX changes you noticed during the sweep**
  **Instead:** Mention them in one line at the end ("noticed ProjectDialog also lacks autofocus — flag for later?") and stop.
  **Why:** The user invoked a specific change. Bundling other improvements turns a focused diff into a sprawling one and obscures the requested change in review.

- **NEVER run this skill for changes the user has already scoped explicitly**
  **Instead:** If the user said "only in NewAgentDialog" or "just this modal", skip the sweep and implement directly.
  **Why:** Re-litigating an already-scoped decision wastes the user's time and trains them that the skill is noise.

- **NEVER extract a shared hook/wrapper for 1–2 sites**
  **Instead:** Inline at each site. Revisit extraction when a 3rd site joins.
  **Why:** A hook used twice costs more in indirection than it saves in lines. The Rule of Three exists because abstractions designed from two examples usually mis-fit the third.

- **NEVER inline the same handler at 3+ sites without proposing extraction**
  **Instead:** Stop at Step 4, propose the seam, get user's e/i choice, then proceed.
  **Why:** Silently fanning out duplicate behavior is the exact drift this skill was extended to prevent — finishing the propagation without the extraction question defeats half its purpose.

- **NEVER propagate a behavior without its visual affordance**
  **Instead:** Copy the `<kbd>` hint, aria-keyshortcuts, or footer line from the source site. If the source has no affordance either, flag it for the user rather than silently shipping the gap.
  **Why:** A hotkey nobody can see is a hotkey nobody uses. The button label and the keyboard handler are halves of one pattern — splitting them ships the cost (extra code, extra surface) without the benefit (discoverability).

- **NEVER design the seam from the first site alone**
  **Instead:** Read all approved sites first; let the union of their needs shape the hook/wrapper signature.
  **Why:** Seams designed from one example bake in that example's quirks (a specific ref shape, a specific event source) and force later sites into awkward adapter code or opt-outs.
