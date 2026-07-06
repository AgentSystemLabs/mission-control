import { sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// Escape SQLite LIKE wildcards so a user typing `%`, `_`, or `\` searches
// literally. Paired with `likeEscaped`, which emits the matching `ESCAPE '\'`.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `column LIKE pattern ESCAPE '\'` — pair the pattern with `escapeLike`. */
export function likeEscaped(column: AnySQLiteColumn, pattern: string): SQL {
  // `'\\'` in this template literal is a single literal backslash in the SQL.
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}
