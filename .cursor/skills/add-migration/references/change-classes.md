# Migration Change Classes

Every schema change is one of three classes. The deployment pattern follows from the class. If a request feels like it spans classes, split it into multiple migrations.

---

## ADDITIVE

The new schema is a strict superset of the old. Old code, deployed before or after the migration, keeps working with no behavior change.

Examples:
- New table.
- New nullable column.
- New column with a default that's safe at row-creation time (constants, `gen_random_uuid()`).
- New index (still ADDITIVE, but require `CONCURRENTLY` on large tables).
- New foreign key on a column that was already conforming.
- New enum value (in DBs that allow concurrent extension — Postgres ≥ 12 with `ADD VALUE`).

Single-step deploy. Apply the migration any time relative to the code deploy.

---

## MUTATING

The shape of existing rows or the constraints on a table changes. Old code may interpret rows incorrectly, or new code may fail against not-yet-migrated rows.

Examples:
- Adding a NOT NULL column to a populated table.
- Changing a column's type (even widening — VARCHAR(50) → VARCHAR(200) — can rewrite the table on some engines).
- Adding a UNIQUE constraint to a column that already has values.
- Changing a column's default in a way that affects historical rows on rewrite.
- Renaming a column or table (drizzle-kit infers as drop + add — actually DESTRUCTIVE; explicit rename via raw SQL is MUTATING).
- Splitting one column into two, or merging two columns into one.

Three-step deploy:

1. **Tolerate both shapes in code.** The application reads from either old or new structure and writes to whichever is current. Deploy.
2. **Migrate the data / add the constraint.** Backfill if needed. Apply the constraint.
3. **Code requires only the new shape.** Remove the dual-shape tolerance. Deploy.

Each step is its own commit/migration/deploy. Skipping the dual-shape step is the most common cause of broken deploys.

---

## DESTRUCTIVE

Data is removed or made inaccessible. Cannot be recovered from the schema alone — only from a backup.

Examples:
- Dropping a column.
- Dropping a table.
- Removing an enum value (most DBs do not support this; usually requires data migration).
- DROP CONSTRAINT that allows previously-rejected data (rare, but classifies here because it changes the data invariant).
- Truncating data (not strictly schema, but treat as DESTRUCTIVE).

Three-step deploy with a wait between steps 1 and 2:

1. **Stop reading and writing the column/table.** Code change only. Deploy.
2. **Wait.** Confirm via logs or metrics that no reads/writes are reaching the column. Duration: at least one full deploy cycle, ideally a day.
3. **Drop.** Migration.

Recordkeeping for DESTRUCTIVE migrations:
- Record a backup pointer (DB snapshot SHA, dump filename, PITR timestamp) in a notes file beside the migration.
- The migration commit message must reference the backup pointer.
- Get explicit user `y` before generating the destructive migration.

---

## Edge cases

**Rename a column.**
- Drizzle/Prisma diff usually produces drop-old + add-new = DESTRUCTIVE + lost data.
- The safe pattern is MUTATING: add new column, dual-write, backfill, swap reads, remove old. Across multiple deploys.
- Or use a raw SQL `ALTER TABLE ... RENAME COLUMN` (single MUTATING step) — but rolling deploys still see old pods reading the old name. Acceptable only if you can synchronize the cutover (downtime, zero-replica deploy).

**Change a column type to a wider compatible type.**
- Postgres often does this without a table rewrite (`VARCHAR(50)` → `TEXT`).
- Some changes do rewrite (`VARCHAR(200)` → `VARCHAR(50)` if any value is too long → fails; `INTEGER` → `BIGINT` rewrites). Verify with `EXPLAIN` or read the engine's docs before classifying.
- When in doubt, classify as MUTATING.

**Add a column with `DEFAULT <literal>` on a populated table.**
- Postgres ≥ 11: ADDITIVE for non-volatile defaults — no table rewrite, lookup is virtual.
- Older Postgres or other engines: rewrites the table → MUTATING.
- `DEFAULT now()` / `DEFAULT random()` always rewrites → MUTATING; also produces per-row evaluation, often not what's intended.

**Drop an unused index.**
- ADDITIVE? No — it can change query plans dramatically. Treat as MUTATING: deploy and watch query performance, then drop in a follow-up if no regressions.
