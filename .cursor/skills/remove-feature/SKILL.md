---
name: remove-feature
description: Safely delete a feature, route, component, endpoint, or module and sweep every piece of dead code the deletion orphans — unused imports, empty files, dead types/helpers/tests/fixtures/docs/i18n keys/env vars/flags/nav links/analytics events/DB columns. Maps every reference (including dynamic/string-based ones) before deleting, deletes leaf-first, and re-sweeps until the graph is stable. Accepts `mode=fast|balanced|production` to control depth (default: balanced); also accepts `include=` / `skip=` overrides. Trigger phrases — "remove this feature", "delete this page/route/component", "rip out X", "tear out the Y system", "kill this endpoint", "we're not using this anymore", "deprecate and remove", "/remove-feature", "clean up after deleting X". Skip for: pure refactors that preserve behavior, enum-value removal where the feature stays (realign), single-file dead-code cleanup with no feature boundary, and pure renames.
---

> **User-question protocol:** Whenever this skill needs the user to pick between options, confirm an action, or answer a multiple-choice prompt, you MUST call the `AskUserQuestion` tool to render a proper interactive picker. Do NOT print numbered options as plain text and wait for the user to type a number — that produces a degraded UX. Free-form questions (open-ended typing) may be asked in prose, but any time you would write "1) … 2) … 3) …", use `AskUserQuestion` instead.


# Remove Feature

Deletion is destructive and asymmetric: a missed reference breaks the build, but a missed dead helper rots silently for months. Both matter. Work the phases in order — each phase has an exit condition you must clear before moving on.

---

## Modes

This skill accepts a `mode=` argument. Default — when no `mode=` is specified — is `balanced`: the full 6-phase pipeline below.

| Mode | Behavior |
|---|---|
| `fast` | Run Phases 2 (map references), 3 (classify), 4 (delete), 6 (verify). Skip Phase 1 (boundary user-confirm) and Phase 5 (multi-pass re-sweep). For obvious-feature deletions where the user has already explicitly confirmed scope. |
| `balanced` (default) | Full 6-phase workflow. |
| `production` | `balanced` + after Phase 6, broader smoke verification: dev-server check on 3+ adjacent features, explicit user sign-off before declaring done. |

**`include=` / `skip=` overrides.** Add or remove specific phases — `mode=fast include=p5` re-enables the multi-pass re-sweep; `mode=production skip=adjacent-smoke` skips the broader smoke check.

**Mode safety override (universal — overrides `mode=fast`).** If Phase 2 surfaces references suggesting an external contract — public package exports, webhook payload shapes, public URLs, or DB columns read by services outside this codebase — `mode=fast` is refused. Surface the external consumers and force `balanced` or `production`. The "NEVER delete code that is part of a public/external contract" rule below is universal across modes.

**Phase-gated NEVER scope.** When `mode=fast` is in effect, the boundary-confirmation discipline of Phase 1 and the orphan-resweep guarantee of Phase 5 are explicitly suspended for the run — fast mode trades exhaustiveness for speed on obvious deletions. The remaining NEVERs (no string/dynamic-reference miss, no migration history edits, no shared-utility assumption, no scope creep, no public-contract delete, no Phase-6 stub, no mega-commit) stay in force in every mode.

---

## Phase 1 — Define the boundary

Before searching or deleting, write down (in chat, to the user):

- **Entry points being removed:** routes, exported functions, CLI commands, public API endpoints, UI buttons/nav items, scheduled jobs, event handlers.
- **What explicitly stays:** shared utilities, design-system primitives, types used by other features, DB tables that other features also write to.
- **External consumers:** is any deleted symbol part of a public package API, a webhook contract, a URL other systems link to, or a DB column other services read? If yes, removal needs a deprecation path, not a delete — stop and confirm with the user.

**Exit condition:** the user has confirmed the boundary. (Skipped only when `mode=fast` is in effect — see "Phase-gated NEVER scope" above.)

---

## Phase 2 — Map references (the part grep alone gets wrong)

Static `grep` on symbol names finds most call sites but misses these classes — go through each one deliberately:

- **String-based references:** route paths (`"/admin/billing"`), i18n keys (`t("billing.title")`), feature-flag names, analytics event names, CSS class names, DOM IDs, query keys, job names, queue names.
- **Dynamic dispatch:** registries (`ROUTES[name]`), DI containers, plugin manifests, `require(variable)`, dynamic `import()`, reflection.
- **Build-time codegen / config:** route manifests, OpenAPI specs, GraphQL schemas, generated types, sitemap entries, robots/redirects, `package.json` scripts/exports, tsconfig path aliases.
- **Persisted state — schema:** DB columns, migration files, seed data, cached blobs, localStorage keys, cookie names.
- **Persisted state — existing row values:** stale data still living inside columns/documents that survive the removal — enum values no longer in code, status strings, JSON blob fields, FK rows pointing at removed entities, cached/denormalized copies. Symbol grep and schema grep both miss these because the column/table itself stays. Example: removing an `interrupted` task status drops the enum from the code mapping cleanly, but rows already persisted with `status='interrupted'` are unaddressed — no code path renders them, no migration mentions them, and no grep surfaces them.
- **Operational surfaces:** docs/README, CHANGELOG, env var examples (`.env.example`), feature flags in the flag service, dashboards/alerts, runbooks.

For each reference found, record: file path, line, and **kind** (call site / type / string / config / persisted / doc). The kind drives Phase 4's deletion order.

> If the codebase is large, fan out searches by class — symbol grep, string grep, config-file grep — rather than one giant pass.

**Exit condition:** every kind above has been searched. A "0 results" answer is a valid result, but the search must have happened.

> **Worked example.** Removing the `/admin/billing` route fans out into: symbol grep finds the page component and its handlers; *string* grep for `"/admin/billing"` finds a redirect rule, a sitemap entry, and an analytics event; i18n grep for `billing.*` finds 14 translation keys across 6 locale files; config grep finds an env var `BILLING_WEBHOOK_SECRET` and a feature flag `admin_billing_v2`. Symbol grep alone would have caught roughly a third of it.

---

## Phase 3 — Confirm each reference is feature-only

For each call site or import found, ask: **"If I delete the target, is this caller now dead too, or does it serve other features?"**

- **Feature-only** → goes on the deletion list.
- **Shared** → the caller stays; only its feature-specific branch is removed (e.g., remove one `case` from a switch, one route from a registry, one menu item from a nav array). Do not delete the file.
- **Ambiguous** → pause and ask the user. Do not guess on shared-looking utilities; that's how unrelated features break.

Watch specifically for: `utils/` and `lib/` files that look feature-named but have other importers; types re-exported through a barrel (`index.ts`); hooks/components used by tests or stories outside the feature.

**Exit condition:** every reference is classified as feature-only, shared, or escalated to the user.

---

## Phase 4 — Delete leaf-first

Order matters. Deleting roots first leaves you editing files that will themselves be deleted seconds later — wasted churn and a broken intermediate state. Work the dependency graph from leaves upward:

1. **Tests and fixtures** for the feature.
2. **Leaf modules** — components, helpers, hooks that nothing else imports.
3. **Aggregators** — barrels, registries, route tables, nav arrays (remove the entry, not the file).
4. **Entry points** — pages, routes, top-level handlers.
5. **Persisted state** — DB columns and their migrations come last and need their own decision (see below).
6. **Config & docs** — env vars, flags, README sections, CHANGELOG entry for the removal.

**Persisted data is two separate decisions, not an automatic delete.**

*(a) Schema decision.* Dropping a column is irreversible and may break replicas, analytics pipelines, or historical queries. Default to: stop writing the column now, schedule the drop in a later migration, and confirm with the user before generating any `DROP COLUMN` / destructive migration. Never delete or edit existing migration files — write a new migration.

*(b) Existing-data decision.* The schema can be clean while rows still hold values tied to the removed feature (the `interrupted` status, the dropped enum variant, FK rows pointing at deleted entities, JSON blobs with stale keys). Use Phase 2's reference map to identify candidates — every enum value, status string, and FK target found there is a query target. Surface the counts — query for affected rows and report the number to the user — then ask which path to take: backfill/migrate to a replacement value, leave as historical (read-only) data, or hard-purge. Default behavior is **surface and ask** — never silently leave the rows in place and never silently rewrite them. Capture the chosen path in a migration or a one-shot data script, not in ad-hoc queries.

**Exit condition:** every item from Phase 3's deletion list has been removed, or explicitly deferred with a note.

---

## Phase 5 — Re-sweep for newly-orphaned code

Deletion creates new orphans: a helper that only the deleted component used, a type only the deleted route returned, a translation key only the deleted page rendered. The first pass will not catch them — they were not orphans yet when you searched.

Repeat the search → confirm → delete loop until a full pass produces zero new deletions. Two passes is common; three is normal for larger features.

**MANDATORY — READ [`references/sweep-checklist.md`](references/sweep-checklist.md)** at the start of Phase 5 and run through every category. Do NOT load this file during Phases 1–4.

**Exit condition:** a full sweep completes with no new orphans found.

---

## Phase 6 — Verify

Run the project's actual checks (type-check, lint with unused-import rules, tests, build) plus a **dev-server smoke check on adjacent features** — the smoke check is the non-default step and catches runtime route/registry breakage that static checks miss.

If a check doesn't exist in this project (no test suite, no type-checker, no linter), note the gap in the PR/removal report rather than skipping silently — coverage holes are themselves part of the removal's risk surface.

If any check fails, the failure points to either (a) a missed reference (go back to Phase 2) or (b) a "shared" caller misclassified as "feature-only" in Phase 3. Fix the root cause; do not paper over with a stub.

**Exit condition:** all checks pass and the user has confirmed the removal, or you have flagged remaining items (e.g., "DB column drop deferred to migration #N").

---

## Adjunct skill routing

After Phase 4 and before declaring verification complete, run only the adjuncts whose gates match the deletion. Honor `skip=` from the caller.

- `agentsystem-core:add-migration` — when the removal changes schema, drops/stops-writing columns, removes enum values from persisted rows, changes indexes/constraints, or requires a backfill/purge/historical-data decision.
- **`reviewer-data-integrity`** subagent (`Agent(subagent_type=reviewer-data-integrity)`) — after any persisted-data, migration, delete cascade, import/export, seed-data, or data-access-invariant change.
- **`reviewer-contracts`** subagent (`Agent(subagent_type=reviewer-contracts)`) — when the removal touches public URLs, route params, API responses, DTOs, server functions, OpenAPI/tRPC/generated clients, package exports, webhook payloads, or generated schemas.
- **`reviewer-error-boundaries`** subagent (`Agent(subagent_type=reviewer-error-boundaries)`) — when the removed feature leaves adjacent user flows with changed failure paths, fallback routes, empty states, or loader errors.
- **`reviewer-client-bundle`** subagent (`Agent(subagent_type=reviewer-client-bundle)`) — when the removal deletes or moves client routes/components/dependencies and may leave stale dynamic imports, unused large deps, or server/client import drift.
- `agentsystem-launch-kit:code-enforce-route-data` — in TanStack Start apps when routes, loaders, `src/queries/**`, query options, or in-app navigation links changed during the removal.
- `agentsystem-launch-kit:code-enforce-layers` — in TanStack Start apps when deleting/repointing `src/fn/`, `src/use-cases/`, or `src/data-access/` changes layer ownership.
- `agentsystem-core:sync-docs` — recommend or invoke when existing docs, API docs, README, `.env.example`, setup docs, or runbooks mention the removed feature. This skill updates existing docs only; it does not create new files.
- `agentsystem-core:update-changelog` — invoke when the removal is user-visible or engineering-significant and the project has a changelog convention.

---

## NEVER

- **NEVER delete a file because grep returned zero results without checking string-based and dynamic references**
  **Instead:** Run Phase 2's full reference-class checklist; "no symbol matches" is not "no references".
  **Why:** Routes, i18n keys, feature flags, and registry entries are all referenced by string — symbol grep silently misses them and the feature breaks at runtime, not build time.

- **NEVER drop or edit existing DB migration files to "clean up" a removed feature's history**
  **Instead:** Stop writing the column, then add a new migration that drops it (after confirming with the user).
  **Why:** Migration files are an append-only ledger — any environment past that point already ran them. Editing history breaks every replica, every fresh-clone setup, and every developer machine.

- **NEVER assume a `utils/` or `lib/` file is feature-only because of its name**
  **Instead:** Check importers explicitly in Phase 3; classify as shared if any non-feature file imports it.
  **Why:** The most common dead-code-removal regression is deleting a "feature helper" that another feature quietly started using months ago.

- **NEVER expand scope mid-removal to refactor adjacent code**
  **Instead:** File a follow-up task; keep the deletion PR scoped to the deletion.
  **Why:** A destructive PR mixed with refactor changes is impossible to review and impossible to bisect when something breaks downstream — the rollback options collapse to all-or-nothing.

- **NEVER delete code that is part of a public/external contract without an explicit deprecation decision**
  **Instead:** Stop in Phase 1, list the external consumers, and ask the user how to deprecate.
  **Why:** Public package exports, webhook payload shapes, public URLs, and DB columns read by other services are seen by code you cannot grep. Deletion = breakage you find from a customer report, not a CI run.

- **NEVER paper over a Phase 6 check failure with a stub, `any` cast, or skipped test**
  **Instead:** Trace the failure back to a missed reference or misclassified caller and fix the underlying mapping.
  **Why:** A stub left behind in a deletion PR is itself dead code — the very thing this skill exists to prevent.

- **NEVER complete a removal without addressing existing persisted data that referenced the removed feature**
  **Instead:** In Phase 2, identify rows holding values tied to the removed feature (enum values, status strings, FK targets, JSON blob fields). In Phase 4's existing-data decision, surface the row counts and ask the user for the migration / leave-as-historical / purge call. Triggers whenever Phase 2 found enum values, status strings, or FK targets tied to the removed feature.
  **Why:** The schema looks clean, the build passes, the type-check passes — and live queries still return rows with values no code path handles. The breakage shows up weeks later as a silent UI failure, a 500 from an unhandled enum, or a join returning ghosts. The deletion looked done; the data said otherwise.

- **NEVER batch the entire removal into one giant commit**
  **Instead:** At minimum split into (1) remove call sites / entry points, (2) delete now-orphaned modules, (3) cleanup config/docs/persisted-state. Stage so each commit builds.
  **Why:** A single mega-commit makes bisecting an incident impossible and review meaningless; staged commits also let the user halt mid-removal if a shared dependency surfaces.

---

## Post-step: /simplify

After removal, surrounding code often loses a reason to exist as a separate abstraction (lone-caller helpers, single-branch conditionals, parameters only used by the deleted path). Run `agentsystem-core:simplify` against the diff to collapse the leftovers.
