import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { projects } from "~/db/schema";
import { events } from "../../events";
import { deleteAllProjectImagesFor } from "../project-images";
import { listTasksForProject } from "../tasks";
import { listUserTerminals } from "../user-terminals";

export function deleteProject(id: string): boolean {
  const db = getDb();
  const taskIds = listTasksForProject(id).map((t) => t.id);
  const userTerminalIds = listUserTerminals(id).map((t) => t.id);
  const result = db.delete(projects).where(eq(projects.id, id)).run();
  if (result.changes > 0) {
    deleteAllProjectImagesFor(id);
    for (const tid of taskIds) events.emit("task:deleted", { id: tid, projectId: id });
    for (const utid of userTerminalIds)
      events.emit("user-terminal:deleted", { id: utid, projectId: id });
  }
  events.emit("project:deleted", { id, taskIds, userTerminalIds });
  return result.changes > 0;
}
