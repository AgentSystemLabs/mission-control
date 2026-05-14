# Code Smell Catalog

Extended catalog for Phase 3 review agents. Load only when entering Phase 3.

---

## Agent 2 — Code Quality (extended)

The headline items live in SKILL.md Phase 3. The full catalog:

- **DRY violations**: near-duplicate code blocks that should be unified — but only if they encode the same rule. See NEVER list in SKILL.md on premature DRY.
- **Long files / long functions**: files >300 lines or functions >50 lines that have natural seams. A cohesive 400-line file is fine; an incoherent 200-line file is not.
- **Giant UI components**: components rendering 3+ logical sub-regions inline — propose extraction with clear prop boundaries. Drives reuse and isolates rerenders.
- **Magic numbers and strings**: `setTimeout(3000)`, `if (count > 5)`, `"admin"` literals — replace with named constants in the existing constants file (or a new one if the project has none). Name by business meaning, not value.
- **Poor naming**: single-letter variables outside loops, abbreviations that aren't domain-standard, function names that don't describe the return value, boolean names without `is`/`has`/`should` prefix.
- **Tight coupling**: a module reaching into another module's internals; new code that would block reuse because it hard-codes a caller-specific concern.
- **API duplication**: repeated request/response handling, repeated auth checks, repeated validation — pull into a helper at the route boundary.
- **Nested conditionals**: ternary chains, nested if/else, or nested switch 3+ levels deep — flatten with early returns, guard clauses, or a lookup table.
- **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls.
- **Parameter sprawl**: 5+ params, or new params bolted on instead of restructuring an options object or splitting the function.
- **Leaky abstractions**: exposing internals that should be encapsulated, breaking existing abstraction boundaries.
- **Stringly-typed code**: raw strings where constants, enums (string unions), or branded types already exist in the codebase.
- **Unnecessary JSX nesting**: wrapper Boxes/divs that add no layout value — check if the inner component's props (flexShrink, alignItems) already provide the needed behavior.
- **Unnecessary comments**: comments narrating WHAT the code does or referencing the task/caller — delete; keep only non-obvious WHY (hidden constraint, subtle invariant, workaround for a specific bug).

---

## Agent 3 — Efficiency (extended)

- **Unnecessary work**: redundant computations, repeated file reads, duplicate API calls, N+1 query patterns.
- **Missed concurrency**: independent operations run sequentially when they could run in parallel (`Promise.all`, structured concurrency).
- **Hot-path bloat**: blocking work added to startup, per-request, or per-render paths.
- **Recurring no-op updates**: state/store updates inside polling loops, intervals, or event handlers that fire unconditionally — add a change-detection guard so downstream consumers aren't notified when nothing changed. If a wrapper takes an updater/reducer callback, verify it honors same-reference returns; otherwise callers' early-return no-ops are silently defeated.
- **Memory**: unbounded data structures, missing cleanup, event-listener leaks.
- **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error.
- **Overly broad operations**: reading entire files when only a portion is needed, loading all rows when filtering for one.
