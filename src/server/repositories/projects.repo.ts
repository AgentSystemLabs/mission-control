import { eq, asc } from "drizzle-orm";
import { getDb } from "~/db/client";
import { projects } from "~/db/schema";
import type { Project } from "~/db/schema";

export function findAllProjects(): Project[] {
  return getDb().select().from(projects).orderBy(asc(projects.createdAt)).all();
}

export function findProjectById(id: string): Project | null {
  return getDb().select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

export function findProjectIds(): { id: string }[] {
  return getDb().select({ id: projects.id }).from(projects).all();
}

export function findProjectIdsBySandboxId(sandboxId: string): string[] {
  return getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.sandboxId, sandboxId))
    .all()
    .map((row) => row.id);
}

export function findProjectNameById(id: string): string | null {
  const row = getDb()
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, id))
    .get();
  return row?.name ?? null;
}

export function projectExists(id: string): boolean {
  return !!getDb().select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
}

export function insertProject(row: Project): void {
  getDb().insert(projects).values(row).run();
}

export function updateProjectRow(id: string, patch: Partial<Project>): void {
  getDb().update(projects).set(patch).where(eq(projects.id, id)).run();
}

export function deleteProjectRow(id: string): number {
  const result = getDb().delete(projects).where(eq(projects.id, id)).run();
  return result.changes;
}

export function orphanProjectsByGroupId(groupId: string): void {
  getDb().update(projects).set({ groupId: null }).where(eq(projects.groupId, groupId)).run();
}
