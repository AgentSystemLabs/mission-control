import { asc, eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { terminalLogs } from "~/db/schema";

export type TerminalLogRow = {
  id: string;
  taskId: string;
  chunk: string;
  createdAt: number;
};

export function insertTerminalLog(row: TerminalLogRow): void {
  getDb().insert(terminalLogs).values(row).run();
}

export function findTerminalLogsByTaskId(taskId: string): TerminalLogRow[] {
  return getDb()
    .select()
    .from(terminalLogs)
    .where(eq(terminalLogs.taskId, taskId))
    .orderBy(asc(terminalLogs.createdAt))
    .all();
}

export function deleteTerminalLogById(id: string): void {
  getDb().delete(terminalLogs).where(eq(terminalLogs.id, id)).run();
}
