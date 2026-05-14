---
name: add-migration
description: Generate and review a Drizzle (or Prisma / Knex / raw SQL) migration safely — classifies the change as additive, mutating, or destructive; for mutating/destructive changes, splits into a multi-phase plan (deploy code that tolerates both shapes → migrate → deploy code that requires the new shape). Catches the landmines: NOT NULL on a populated column without backfill, dropping a column still referenced by old code, adding a unique constraint with existing duplicates, large-table index without `CONCURRENTLY`, type changes that rewrite the table, default values evaluated at migration time vs. row time. Trigger phrases — "add a migration", "schema change", "add column to X", "drop column X", "rename column", "add index", "/add-migration", "drizzle migration", "alter table". Skip for — pure code changes with no schema impact, seed-data-only changes (use add-seed-data), and infra-level changes (DB version upgrades, replication setup).
---

# Code Add Migration

A migration that breaks production usually broke at design time, not at run time. Classify the change first; the plan follows from the class.

---

## Phase 1 — Detect Migration Tooling

In order:

1. `drizzle.config.*` → Drizzle (`drizzle-kit generate`).
2. `prisma/schema.prisma` → Prisma (`prisma migrate dev --create-only`).
3. `knexfile.*` → Knex (`knex migrate:make`).
4. `migrations/` with bare `.sql` files → raw SQL (project's own runner).

If none detected and the user wants a migration, ask which tool they use rather than picking one.

**Exit:** the migration tool, command, and output directory are known.

---

## Phase 2 — Classify the Change

**MANDATORY — READ [`references/change-classes.md`](references/change-classes.md)** before classifying. Every change falls into one of three classes; the deployment plan depends on the class.

```
ADDITIVE    — strictly adds. Old code keeps working unchanged.
MUTATING    — changes shape of existing rows or constraints. Old code may break.
DESTRUCTIVE — removes data or columns. Cannot be reverted from data alone.
```

State the class and the one-line reason. If the user's request mixes classes (e.g., "rename column" = drop + add + backfill), split it into separate migrations.

**Exit:** every requested change has exactly one class.

---

## Phase 3 — Plan by Class

### ADDITIVE

Single migration. Examples: new nullable column, new table, new index, new enum value (if the DB supports concurrent enum extension).

Generate the migration. Add the index `CONCURRENTLY` if the table has any non-trivial size and the DB engine is Postgres. For Drizzle, this requires raw SQL (`drizzle-kit` does not emit `CONCURRENTLY` from schema diffs alone).

### MUTATING

Multi-step plan. Each step is its own deploy + migration:

1. **Code tolerates both shapes.** Update the application to read/write either old or new shape.
2. **Backfill / migrate data.** Run the migration. For NOT NULL adds: column is added nullable, backfilled, then constrained to NOT NULL in a third step. For type changes: add new column, dual-write, backfill, swap reads, drop old.
3. **Code requires new shape only.** Remove the dual-shape tolerance.

State each step explicitly. Do not collapse them into a single migration even if the table is small today — the pattern is what makes it safe at scale.

### DESTRUCTIVE

Multi-step plan with a wait period:

1. **Stop writing to the column/table.** Update code to neither read nor write it. Deploy.
2. **Verify in production logs/metrics** for at least one full deployment cycle (not enforced by this skill — but call it out).
3. **Drop the column/table.** Migration.

For dropping rows (data deletion), get an explicit user `y` and require a backup pointer (snapshot SHA, dump filename) be recorded in the migration's accompanying notes file.

**Exit:** the plan is written down with one migration per step.

---

## Phase 4 — Generate

Run the project's generate command. For Drizzle:

```bash
pnpm drizzle-kit generate
```

Open the generated SQL. **Read it.** drizzle-kit can produce surprising diffs (renames inferred as drop+add, default-value reordering). If the SQL doesn't match the plan, edit it directly — or adjust the schema and regenerate.

For each migration file, verify:

- Index creation on tables with > a few thousand rows uses `CREATE INDEX CONCURRENTLY` (Postgres). If the tool can't emit this, hand-edit the SQL and add a note in the migration that it must be run outside a transaction.
- Adding a NOT NULL column has a default OR is followed in a later step by the backfill + constraint.
- Default values: `DEFAULT now()` is evaluated per row; `DEFAULT '2026-01-01'` is a literal. Make sure the right one was generated.
- Foreign-key drops/adds: confirm cascade behavior matches the schema's `references(...).onDelete(...)`.

**Exit:** the migration SQL has been read and matches the plan.

---

## Phase 5 — Backfill (if MUTATING)

For backfills that touch many rows:

```sql
-- Bad: locks the table for the entire UPDATE
UPDATE big_table SET new_col = derive(old_col);

-- Good: chunked
UPDATE big_table SET new_col = derive(old_col)
WHERE id BETWEEN <lo> AND <hi>;
```

For Postgres on tables expected to grow large, use `LIMIT` + loop or a chunked migration script. The migration runner alone does not chunk.

If the project has no convention for chunked backfills, write the backfill as a separate `*.sql` file and a one-line note in the migration: `-- Run scripts/backfill-<n>.sql before applying the NOT NULL constraint in <next>.sql`.

**Exit:** a backfill plan exists for any column being made NOT NULL on populated data.

---

## Phase 6 — Test the Migration

Run against a local/test DB:

1. Restore the DB to a state representative of production (seeded fixtures, ideally a dump).
2. Apply the migration.
3. Apply the next migration in line, if any.
4. Run the app's test suite — at minimum the data-access tests.

If the migration fails to apply on representative data, fix it. If the tests fail, the dual-shape tolerance from Phase 3 step 1 is missing.

**Exit:** migration applies cleanly on representative data; tests pass.

---

## Phase 7 — Report

```
Migration added: <file path>
  Class:       <ADDITIVE / MUTATING / DESTRUCTIVE>
  Plan:        <step 1>: <this migration>
               <step 2>: <next migration's purpose, if multi-step>
               <step 3>: <next>
  Backfill:    <none / inline / scripts/backfill-N.sql>
  Concurrent:  <yes/no — and why>
  Reversible:  <yes / no, requires restoring from <backup pointer>>

Apply locally: <command>
Apply in prod: <command>  (run during low-traffic window if step requires lock)
```

If the change was MUTATING or DESTRUCTIVE, remind the user that step 1 must deploy *before* step 2 runs in production.

---

## Post-step: data-integrity audit

After the migration file and any backfill script are in place, dispatch the **`reviewer-data-integrity`** subagent (`Agent(subagent_type=reviewer-data-integrity)`) against the migration + related code diff. It should check defaults/backfills, destructive rollout order, uniqueness assumptions, delete cascades, seed/test fixture drift, and data-access invariants before the migration is declared shippable.

---

## NEVER

- **NEVER add a NOT NULL column to a populated table in a single step.**
  **Instead:** add nullable, backfill, then add the NOT NULL constraint in a follow-up migration.
  **Why:** a single-step NOT NULL on a populated table requires a default. The default applies at migration time and locks the table while every row is rewritten — minutes to hours of downtime on large tables. The three-step pattern is online.

- **NEVER drop a column in the same deploy that stops using it.**
  **Instead:** deploy code that no longer references the column → wait for the deploy to settle → drop the column in a follow-up migration.
  **Why:** during a rolling deploy, old pods still query the column; dropping it in the same release crashes those pods until they're replaced. Production goes down for the duration of the rollout.

- **NEVER add an index on a large table without `CONCURRENTLY` (Postgres).**
  **Instead:** hand-edit the migration SQL to use `CREATE INDEX CONCURRENTLY` and run it outside a transaction.
  **Why:** a non-concurrent `CREATE INDEX` takes an `ACCESS EXCLUSIVE` lock — every read and write blocks for the duration. On a 50M-row table that's tens of minutes of full unavailability.

- **NEVER add a UNIQUE constraint without checking for existing duplicates.**
  **Instead:** run `SELECT col, count(*) FROM t GROUP BY col HAVING count(*) > 1` against representative data first; resolve duplicates as a backfill.
  **Why:** the migration will fail mid-deploy when it hits the first duplicate, leaving the schema in a partially-applied state — the worst kind of outage to recover from.

- **NEVER assume `drizzle-kit` (or any ORM diff tool) generated what you intended.**
  **Instead:** read the generated SQL line by line. Renames are inferred as drop+add; default values can be reordered; cascades may differ.
  **Why:** the schema is a model; the migration is data loss. The diff between them is where bugs live.

- **NEVER write a single migration that mixes additive, mutating, and destructive changes.**
  **Instead:** split per class. Even if the changes feel related, they have different rollout requirements.
  **Why:** the safe rollout for a destructive change waits between steps; bundling it with additive changes either holds back the additive deploy or rushes the destructive one. Either is wrong.

- **NEVER drop or truncate data without an explicit user `y` and a recorded backup pointer.**
  **Instead:** confirm verbally; record the pre-migration snapshot SHA, dump file path, or PITR timestamp in a notes file alongside the migration.
  **Why:** dropped data is unrecoverable from the migration alone. A recorded backup pointer is the only thing that turns the change from "permanent" into "reversible" if the deploy goes wrong.

- **NEVER use `DEFAULT now()` (or `DEFAULT random()`) in a column-add that's expected to set a literal value at migration time.**
  **Instead:** decide explicitly: backfill with a single literal computed once, or accept that each row gets its own evaluation when the migration runs.
  **Why:** `DEFAULT now()` evaluates per row at the time the row is rewritten — for a long ALTER TABLE, you get spread-out timestamps that look like real activity but aren't. The bug surfaces months later in audit log analyses.
