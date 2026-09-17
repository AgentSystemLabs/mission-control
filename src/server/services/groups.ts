import type { Group } from "~/db/schema";
import { getSqlite } from "~/db/client";
import { GROUP_COLORS } from "~/lib/design-meta";
import { events } from "../events";
import { ValidationError } from "../errors";
import {
  deleteGroupRow,
  findAllGroups,
  findGroupById,
  insertGroup,
  maxGroupSortOrder,
  updateGroupRow,
  updateGroupSortOrder,
} from "../repositories/groups.repo";
import { orphanProjectsByGroupId } from "../repositories/projects.repo";
import { newId } from "./_ids";

export function listGroups(): Group[] {
  return findAllGroups();
}

export function createGroup(input: { name: string; color?: string }): Group {
  if (!input.name?.trim()) throw new Error("Group name is required");
  const existing = listGroups();
  const color = input.color || GROUP_COLORS[existing.length % GROUP_COLORS.length] || "#ff5a1f";
  const row: Group = {
    id: newId("g"),
    name: input.name.trim(),
    color,
    // Append to the end of the manual order.
    sortOrder: maxGroupSortOrder() + 1,
    createdAt: Date.now(),
  };
  insertGroup(row);
  events.emit("group:created", { id: row.id });
  return row;
}

export function updateGroup(id: string, patch: Partial<Pick<Group, "name" | "color">>): Group | null {
  const existing = findGroupById(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  updateGroupRow(id, next);
  events.emit("group:updated", { id });
  return next;
}

/**
 * Persist a full manual ordering of the groups. `order` must list every group
 * id exactly once; each group's sort_order becomes its index. Backfills legacy
 * NULL rows in one pass.
 */
export function reorderGroups(order: string[]): Group[] {
  const apply = getSqlite().transaction(() => {
    const ids = new Set(findAllGroups().map((g) => g.id));
    if (order.length !== ids.size) {
      throw new ValidationError("order must include every group exactly once");
    }
    const seen = new Set<string>();
    for (const id of order) {
      if (!ids.has(id)) throw new ValidationError(`unknown group ${id}`);
      if (seen.has(id)) throw new ValidationError("duplicate group id in order");
      seen.add(id);
    }
    order.forEach((id, index) => updateGroupSortOrder(id, index));
  });
  apply.immediate();
  for (const id of order) events.emit("group:updated", { id });
  return listGroups();
}

export function deleteGroup(id: string): boolean {
  // orphan projects to ungrouped
  orphanProjectsByGroupId(id);
  const changes = deleteGroupRow(id);
  events.emit("group:deleted", { id });
  return changes > 0;
}
