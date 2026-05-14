# Code Review Checklist

Apply to the feature diff. Report findings as **blocker / should-fix / nit** with file:line references.

## Correctness
- Does the new code actually implement what the approved plan said? Compare diff to plan.
- Edge cases from Phase 1 clarification — are they handled? (empty, null, large input, concurrent, unauthorized)
- Error paths — are failures surfaced or silently swallowed?
- Off-by-one, boundary conditions, fencepost errors in any new loops/ranges
- Promise/async — every promise awaited or intentionally fire-and-forget? No floating promises in handlers.

## Reuse & Duplication
- Any new utility/helper that duplicates an existing one in the repo? Grep before keeping.
- Parallel arrays where a single source of truth would do
- Sibling blocks (JSX, switch arms, if-chains) differing only by a literal — extract or table-drive
- Copy-pasted logic across two files — DRY only if the abstraction earns it

## Clarity
- Names match domain vocabulary already in the codebase
- Functions do one thing; long functions have a real reason
- No stale comments, no `// TODO` without an owner/context, no commented-out code
- No dead branches, no unreachable code, no unused exports introduced by this diff

## Boundaries & Coupling
- New module imports — sensible direction? No circular deps introduced.
- Server code not imported into client bundles (and vice versa)
- Type leaks — internal types not exposed in public API surface
- New shared state — is it actually shared, or accidentally global?

## Conventions
- Matches existing code style (formatting, file layout, naming)
- Test density matches surrounding code
- Logging level / format consistent with project
- Existing patterns reused (custom hooks, error wrappers, etc.) instead of reinvented

## UI Convention Parity (UI diffs only)
- For each new modal/dialog/drawer/sheet/popover/form/confirm-prompt: do siblings in the repo bind a submit hotkey (`Cmd+Enter`)? If yes, this one must too — and the visible label must show the `<Kbd>` hint.
- Esc closes — verified (or inherited from the shared `Modal` primitive).
- Autofocus on the primary input on open, matching siblings.
- Loading/disabled state on the primary action while the async work is in flight.
- Footer chrome (button order, Cancel/Save labels, separators) matches siblings.
- For new buttons that take action: if siblings carry a `<Kbd>` hint and a hotkey binding, this one does too.

## Spec Adherence
- Inputs validated at boundaries (user input, external API)
- Outputs match the contract committed in the plan
- No `any`, no `as unknown as X`, no `@ts-ignore` introduced — if unavoidable, comment why

## Removal
- Any code rendered dead by this feature — was it removed?
- Any flags / config / migrations from a previous attempt left behind?
